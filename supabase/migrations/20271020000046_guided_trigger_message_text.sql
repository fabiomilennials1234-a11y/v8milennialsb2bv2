-- Exact trigger-message text with explicit conversation identity and provenance.
BEGIN;

ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS condition_text text,
  ADD COLUMN IF NOT EXISTS condition_text_source text,
  ADD COLUMN IF NOT EXISTS transcription_text text,
  ADD COLUMN IF NOT EXISTS transcription_provider text,
  ADD COLUMN IF NOT EXISTS transcription_created_at timestamptz;
ALTER TABLE public.channel_messages
  ADD COLUMN IF NOT EXISTS condition_text text,
  ADD COLUMN IF NOT EXISTS condition_text_source text,
  ADD COLUMN IF NOT EXISTS transcription_text text,
  ADD COLUMN IF NOT EXISTS transcription_provider text,
  ADD COLUMN IF NOT EXISTS transcription_created_at timestamptz;

ALTER TABLE public.whatsapp_messages DROP CONSTRAINT IF EXISTS whatsapp_messages_condition_text_source_check;
ALTER TABLE public.whatsapp_messages ADD CONSTRAINT whatsapp_messages_condition_text_source_check
  CHECK ((condition_text IS NULL AND condition_text_source IS NULL) OR
    (NULLIF(btrim(condition_text),'') IS NOT NULL AND condition_text_source IS NOT NULL
      AND condition_text_source = ANY(ARRAY['text','caption','interactive','synthetic']::text[])));
ALTER TABLE public.channel_messages DROP CONSTRAINT IF EXISTS channel_messages_condition_text_source_check;
ALTER TABLE public.channel_messages ADD CONSTRAINT channel_messages_condition_text_source_check
  CHECK ((condition_text IS NULL AND condition_text_source IS NULL) OR
    (NULLIF(btrim(condition_text),'') IS NOT NULL AND condition_text_source IS NOT NULL
      AND condition_text_source = ANY(ARRAY['text','caption','interactive','synthetic']::text[])));
ALTER TABLE public.whatsapp_messages DROP CONSTRAINT IF EXISTS whatsapp_messages_transcription_provenance_check;
ALTER TABLE public.whatsapp_messages ADD CONSTRAINT whatsapp_messages_transcription_provenance_check CHECK (
  (transcription_text IS NULL AND transcription_provider IS NULL AND transcription_created_at IS NULL)
  OR (NULLIF(btrim(transcription_text),'') IS NOT NULL AND NULLIF(btrim(transcription_provider),'') IS NOT NULL AND transcription_created_at IS NOT NULL));
ALTER TABLE public.channel_messages DROP CONSTRAINT IF EXISTS channel_messages_transcription_provenance_check;
ALTER TABLE public.channel_messages ADD CONSTRAINT channel_messages_transcription_provenance_check CHECK (
  (transcription_text IS NULL AND transcription_provider IS NULL AND transcription_created_at IS NULL)
  OR (NULLIF(btrim(transcription_text),'') IS NOT NULL AND NULLIF(btrim(transcription_provider),'') IS NOT NULL AND transcription_created_at IS NOT NULL));

COMMENT ON COLUMN public.whatsapp_messages.condition_text IS 'Texto próprio da mensagem elegível para condição; exclui texto citado incorporado em content.';
COMMENT ON COLUMN public.whatsapp_messages.condition_text_source IS 'Proveniência persistida de condition_text: text, caption, interactive ou synthetic. Linhas antigas ficam NULL; não inferir.';
COMMENT ON COLUMN public.whatsapp_messages.transcription_text IS 'Transcrição já persistida por processo externo. Avaliação nunca cria nem aguarda este valor.';
COMMENT ON COLUMN public.channel_messages.condition_text IS 'Texto próprio da mensagem elegível para condição, separado da apresentação do inbox.';
COMMENT ON COLUMN public.channel_messages.condition_text_source IS 'Proveniência persistida de condition_text: text, caption, interactive ou synthetic. Linhas antigas ficam NULL; não inferir.';
COMMENT ON COLUMN public.channel_messages.transcription_text IS 'Transcrição já persistida por processo externo. Avaliação nunca cria nem aguarda este valor.';

CREATE OR REPLACE FUNCTION public.valid_guided_data_scopes(p_fields text[])
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path = public AS $$
  SELECT p_fields IS NOT NULL AND cardinality(p_fields) <= 256 AND coalesce(array_ndims(p_fields),1)=1
    AND NOT EXISTS (SELECT 1 FROM unnest(p_fields) requested(scope) WHERE scope IS NULL OR NOT (
      scope = ANY(ARRAY['lead.name','lead.company','lead.email','lead.phone','lead.qualification_score','lead.utm_campaign','lead.utm_source','lead.utm_medium','lead.utm_content','lead.utm_term','lead.segment','lead.urgency','lead.faturamento','lead.tags','lead.origin','lead.pre_sale_responsible_id','lead.sale_responsible_id','business.trigger.stage','business.trigger.value','business.trigger.stage_elapsed','business.exists.lifecycle','business.exists.stage','business.exists.value','business.last_won_date','message.trigger.text']::text[])
      OR scope ~ '^lead\.custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'));
$$;
REVOKE ALL ON FUNCTION public.valid_guided_data_scopes(text[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.valid_guided_data_scopes(text[]) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.guided_trigger_message_payload(
  p_organization_id uuid, p_lead_id uuid, p_locator jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$
DECLARE
  v_storage text := p_locator->>'storage'; v_message uuid; v_box uuid;
  v_provider text := p_locator->>'provider'; v_participant text := p_locator->>'participantId'; v_result jsonb;
  v_participant_norm text;
BEGIN
  IF jsonb_typeof(p_locator) IS DISTINCT FROM 'object'
    OR (p_locator->>'messageId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR (p_locator->>'boxId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR v_storage NOT IN ('whatsapp_messages','channel_messages') OR NULLIF(v_provider,'') IS NULL OR NULLIF(v_participant,'') IS NULL
  THEN RAISE EXCEPTION 'context_unavailable' USING ERRCODE='PT404'; END IF;
  v_message := (p_locator->>'messageId')::uuid; v_box := (p_locator->>'boxId')::uuid;
  v_participant_norm := public.normalize_brazilian_phone(v_participant);

  IF v_storage='whatsapp_messages' THEN
    SELECT jsonb_build_object('message_id',m.id,'text',COALESCE(NULLIF(m.condition_text,''),NULLIF(m.transcription_text,'')),
      'text_source',CASE WHEN NULLIF(m.condition_text,'') IS NOT NULL THEN m.condition_text_source WHEN NULLIF(m.transcription_text,'') IS NOT NULL THEN 'transcription' ELSE NULL END,
      'text_provider',CASE WHEN NULLIF(m.condition_text,'') IS NOT NULL THEN COALESCE(NULLIF(w.provider,''),'uazapi') ELSE m.transcription_provider END,
      'text_created_at',CASE WHEN NULLIF(m.condition_text,'') IS NOT NULL THEN m.timestamp ELSE m.transcription_created_at END,
      'text_state',CASE WHEN NULLIF(m.condition_text,'') IS NULL AND NULLIF(m.transcription_text,'') IS NULL
        AND m.message_type=ANY(ARRAY['audio','ptt','image','video','document','sticker']) THEN 'media_without_text' ELSE 'available' END,
      'provider',COALESCE(NULLIF(w.provider,''),'uazapi'),'box_id',w.id,'participant_id',public.normalize_brazilian_phone(m.phone_number))
    INTO v_result FROM public.whatsapp_messages m
    JOIN public.whatsapp_instances w ON w.id=v_box AND w.organization_id=p_organization_id
    JOIN public.leads l ON l.id=p_lead_id AND l.organization_id=p_organization_id AND l.deleted_at IS NULL
    WHERE m.id=v_message AND m.organization_id=p_organization_id AND m.deleted_at IS NULL
      AND m.instance_id=ANY(public.whatsapp_chip_instance_ids(p_organization_id,v_box))
      AND lower(COALESCE(NULLIF(w.provider,''),'uazapi'))=lower(v_provider)
      AND public.normalize_brazilian_phone(m.phone_number)=v_participant_norm
      AND public.normalize_brazilian_phone(l.phone)=v_participant_norm;
  ELSE
    SELECT jsonb_build_object('message_id',m.id,'text',COALESCE(NULLIF(m.condition_text,''),NULLIF(m.transcription_text,'')),
      'text_source',CASE WHEN NULLIF(m.condition_text,'') IS NOT NULL THEN m.condition_text_source WHEN NULLIF(m.transcription_text,'') IS NOT NULL THEN 'transcription' ELSE NULL END,
      'text_provider',CASE WHEN NULLIF(m.condition_text,'') IS NOT NULL THEN COALESCE(w.provider,c.provider) ELSE m.transcription_provider END,
      'text_created_at',CASE WHEN NULLIF(m.condition_text,'') IS NOT NULL THEN m.timestamp ELSE m.transcription_created_at END,
      'text_state',CASE WHEN NULLIF(m.condition_text,'') IS NULL AND NULLIF(m.transcription_text,'') IS NULL
        AND m.message_type=ANY(ARRAY['audio','ptt','image','video','document','sticker']) THEN 'media_without_text' ELSE 'available' END,
      'provider',COALESCE(w.provider,c.provider),'box_id',COALESCE(m.instance_id,m.messaging_channel_id),'participant_id',
        CASE WHEN m.instance_id IS NOT NULL THEN public.normalize_brazilian_phone(m.phone_number) ELSE m.contact_external_id END)
    INTO v_result FROM public.channel_messages m
    LEFT JOIN public.whatsapp_instances w ON w.id=m.instance_id AND w.id=v_box AND w.organization_id=p_organization_id
    LEFT JOIN public.messaging_channels c ON c.id=m.messaging_channel_id AND c.id=v_box AND c.organization_id=p_organization_id
    WHERE m.id=v_message AND m.organization_id=p_organization_id
      AND COALESCE(m.instance_id,m.messaging_channel_id)=v_box
      AND lower(COALESCE(w.provider,c.provider,''))=lower(v_provider)
      AND (CASE WHEN m.instance_id IS NOT NULL THEN public.normalize_brazilian_phone(m.phone_number) ELSE m.contact_external_id END)
        = CASE WHEN m.instance_id IS NOT NULL THEN v_participant_norm ELSE v_participant END
      AND ((m.instance_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id=p_lead_id AND l.organization_id=p_organization_id
              AND l.deleted_at IS NULL AND public.normalize_brazilian_phone(l.phone)=v_participant_norm))
        OR (m.messaging_channel_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.lead_social_identities i
              WHERE i.organization_id=p_organization_id AND i.lead_id=p_lead_id AND i.messaging_channel_id=v_box
                AND i.external_user_id=v_participant AND lower(i.provider)=lower(v_provider))));
  END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.guided_trigger_message_payload(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.guided_trigger_message_payload(uuid,uuid,jsonb) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.test_guided_condition_trigger_message(p_organization_id uuid,p_lead_id uuid,p_locator jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$
DECLARE v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
  v_result := public.guided_trigger_message_payload(p_organization_id,p_lead_id,p_locator);
  IF v_result IS NULL THEN RAISE EXCEPTION 'context_unavailable' USING ERRCODE='PT404'; END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.test_guided_condition_trigger_message(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.test_guided_condition_trigger_message(uuid,uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.read_guided_condition_trigger_message(p_workflow_id uuid,p_organization_id uuid,p_lead_id uuid,p_locator jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.workflows w JOIN public.workflow_data_grants g ON g.workflow_id=w.id AND g.organization_id=w.organization_id
    WHERE w.id=p_workflow_id AND w.organization_id=p_organization_id AND g.resource_scope='organization_leads'
      AND ARRAY['message.trigger.text']::text[] <@ g.fields AND NOT public.org_access_blocked(w.organization_id) FOR SHARE OF w,g;
  IF NOT FOUND THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
  v_result := public.guided_trigger_message_payload(p_organization_id,p_lead_id,p_locator);
  IF v_result IS NULL THEN RAISE EXCEPTION 'context_unavailable' USING ERRCODE='PT404'; END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.read_guided_condition_trigger_message(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_guided_condition_trigger_message(uuid,uuid,uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.validate_guided_trigger_message_version()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_invalid text[];
BEGIN
  WITH RECURSIVE conditions(node_id,condition) AS (
    SELECT node->>'id',node->'data'->'guidedCondition' FROM jsonb_array_elements(NEW.definition->'nodes') node WHERE node->>'type'='condition'
    UNION ALL SELECT conditions.node_id,child FROM conditions CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN conditions.condition->>'kind'='group' THEN conditions.condition->'children' ELSE '[]'::jsonb END) child
  ) SELECT array_agg(DISTINCT node_id ORDER BY node_id) FILTER (WHERE NOT (
      (condition->'conversation'->>'kind'='trigger' OR (
        condition->'conversation'->>'kind'='explicit'
        AND condition->'conversation'->>'storage'=ANY(ARRAY['whatsapp_messages','channel_messages'])
        AND condition->'conversation'->>'boxId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND NULLIF(condition->'conversation'->>'provider','') IS NOT NULL))
      AND condition->>'operator'=ANY(ARRAY['equals','not_equals','contains','not_contains','starts_with','ends_with','is_empty','is_not_empty'])
      AND (condition->>'operator'=ANY(ARRAY['is_empty','is_not_empty']) OR NULLIF(condition->>'value','') IS NOT NULL)))
    INTO v_invalid FROM conditions WHERE condition->>'field'='message.trigger.text';
  IF cardinality(v_invalid)>0 THEN RAISE EXCEPTION 'invalid_configuration' USING ERRCODE='22023',DETAIL=jsonb_build_object('nodeIds',v_invalid)::text; END IF;
  IF EXISTS (WITH RECURSIVE conditions(condition) AS (
    SELECT node->'data'->'guidedCondition' FROM jsonb_array_elements(NEW.definition->'nodes') node WHERE node->>'type'='condition'
    UNION ALL SELECT child FROM conditions CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN condition->>'kind'='group' THEN condition->'children' ELSE '[]'::jsonb END) child
  ) SELECT 1 FROM conditions WHERE condition->>'field'='message.trigger.text' AND NOT ('message.trigger.text'=ANY(NEW.required_fields)))
  THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_guided_trigger_message_version() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS validate_guided_trigger_message_version ON public.workflow_guided_versions;
CREATE TRIGGER validate_guided_trigger_message_version BEFORE INSERT OR UPDATE OF definition,required_fields
ON public.workflow_guided_versions FOR EACH ROW EXECUTE FUNCTION public.validate_guided_trigger_message_version();

NOTIFY pgrst,'reload schema';
COMMIT;
