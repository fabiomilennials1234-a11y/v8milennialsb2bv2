BEGIN;
DROP TRIGGER IF EXISTS validate_guided_trigger_message_version ON public.workflow_guided_versions;
DROP FUNCTION IF EXISTS public.validate_guided_trigger_message_version();
DROP FUNCTION IF EXISTS public.read_guided_condition_trigger_message(uuid,uuid,uuid,jsonb);
DROP FUNCTION IF EXISTS public.test_guided_condition_trigger_message(uuid,uuid,jsonb);
DROP FUNCTION IF EXISTS public.guided_trigger_message_payload(uuid,uuid,jsonb);
CREATE OR REPLACE FUNCTION public.valid_guided_data_scopes(p_fields text[])
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path=public AS $$
  SELECT p_fields IS NOT NULL AND cardinality(p_fields)<=256 AND coalesce(array_ndims(p_fields),1)=1
    AND NOT EXISTS (SELECT 1 FROM unnest(p_fields) requested(scope) WHERE scope IS NULL OR NOT (
      scope=ANY(ARRAY['lead.name','lead.company','lead.email','lead.phone','lead.qualification_score','lead.utm_campaign','lead.utm_source','lead.utm_medium','lead.utm_content','lead.utm_term','lead.segment','lead.urgency','lead.faturamento','lead.tags','lead.origin','lead.pre_sale_responsible_id','lead.sale_responsible_id','business.trigger.stage','business.trigger.value','business.trigger.stage_elapsed','business.exists.lifecycle','business.exists.stage','business.exists.value','business.last_won_date']::text[])
      OR scope ~ '^lead\.custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'));
$$;
REVOKE ALL ON FUNCTION public.valid_guided_data_scopes(text[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.valid_guided_data_scopes(text[]) TO authenticated,service_role;
ALTER TABLE public.whatsapp_messages DROP CONSTRAINT IF EXISTS whatsapp_messages_transcription_provenance_check;
ALTER TABLE public.whatsapp_messages DROP CONSTRAINT IF EXISTS whatsapp_messages_condition_text_source_check;
ALTER TABLE public.channel_messages DROP CONSTRAINT IF EXISTS channel_messages_transcription_provenance_check;
ALTER TABLE public.channel_messages DROP CONSTRAINT IF EXISTS channel_messages_condition_text_source_check;
ALTER TABLE public.whatsapp_messages DROP COLUMN IF EXISTS condition_text,DROP COLUMN IF EXISTS condition_text_source,
  DROP COLUMN IF EXISTS transcription_text,DROP COLUMN IF EXISTS transcription_provider,DROP COLUMN IF EXISTS transcription_created_at;
ALTER TABLE public.channel_messages DROP COLUMN IF EXISTS condition_text,DROP COLUMN IF EXISTS condition_text_source,
  DROP COLUMN IF EXISTS transcription_text,DROP COLUMN IF EXISTS transcription_provider,DROP COLUMN IF EXISTS transcription_created_at;
COMMIT;
