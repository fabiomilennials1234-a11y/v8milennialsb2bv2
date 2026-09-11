-- Auditable per-conversation history coverage for guided period conditions.
BEGIN;

CREATE TABLE public.conversation_history_coverage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  storage text NOT NULL CHECK (storage IN ('whatsapp_messages','channel_messages')),
  box_id uuid NOT NULL,
  provider text NOT NULL CHECK (NULLIF(btrim(provider),'') IS NOT NULL),
  participant_id text NOT NULL CHECK (NULLIF(btrim(participant_id),'') IS NOT NULL),
  covered_from timestamptz NOT NULL,
  covered_to timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('complete','in_progress','gapped')),
  gap_reason text,
  source_job_id uuid REFERENCES public.history_sync_jobs(id) ON DELETE SET NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (covered_from < covered_to),
  CHECK ((state = 'complete' AND gap_reason IS NULL) OR (state <> 'complete' AND NULLIF(btrim(gap_reason),'') IS NOT NULL))
);
CREATE INDEX conversation_history_coverage_lookup_idx ON public.conversation_history_coverage
  (organization_id,storage,box_id,provider,participant_id,observed_at DESC);
ALTER TABLE public.conversation_history_coverage ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION public.normalize_conversation_history_coverage_participant() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.storage='whatsapp_messages' THEN NEW.participant_id:=public.normalize_brazilian_phone(NEW.participant_id); END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.normalize_conversation_history_coverage_participant() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER normalize_conversation_history_coverage_participant BEFORE INSERT OR UPDATE OF storage,participant_id
  ON public.conversation_history_coverage FOR EACH ROW EXECUTE FUNCTION public.normalize_conversation_history_coverage_participant();
CREATE POLICY conversation_history_coverage_member_read ON public.conversation_history_coverage FOR SELECT TO authenticated
  USING (organization_id IN (SELECT tm.organization_id FROM public.team_members tm WHERE tm.user_id=auth.uid() AND tm.is_active=true));
CREATE POLICY conversation_history_coverage_service_all ON public.conversation_history_coverage FOR ALL TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.conversation_history_coverage FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.conversation_history_coverage TO authenticated;
GRANT ALL ON public.conversation_history_coverage TO service_role;

CREATE OR REPLACE FUNCTION public.valid_guided_data_scopes(p_fields text[])
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path=public AS $$
  SELECT p_fields IS NOT NULL AND cardinality(p_fields)<=256 AND coalesce(array_ndims(p_fields),1)=1
    AND NOT EXISTS (SELECT 1 FROM unnest(p_fields) requested(scope) WHERE scope IS NULL OR NOT (
      scope=ANY(ARRAY['lead.name','lead.company','lead.email','lead.phone','lead.qualification_score','lead.utm_campaign','lead.utm_source','lead.utm_medium','lead.utm_content','lead.utm_term','lead.segment','lead.urgency','lead.faturamento','lead.tags','lead.origin','lead.pre_sale_responsible_id','lead.sale_responsible_id','business.trigger.stage','business.trigger.value','business.trigger.stage_elapsed','business.exists.lifecycle','business.exists.stage','business.exists.value','business.last_won_date','message.trigger.text','message.period.exists']::text[])
      OR scope ~ '^lead\.custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'));
$$;
REVOKE ALL ON FUNCTION public.valid_guided_data_scopes(text[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.valid_guided_data_scopes(text[]) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.guided_message_period_payload(
  p_organization_id uuid,p_lead_id uuid,p_conversation jsonb,p_from timestamptz,p_to timestamptz
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$
DECLARE v_storage text:=p_conversation->>'storage'; v_box uuid; v_provider text:=p_conversation->>'provider';
  v_participant text; v_match uuid; v_match_at timestamptz; v_coverage text;
BEGIN
  IF p_from>=p_to OR p_to-p_from>interval '366 days' OR v_storage NOT IN ('whatsapp_messages','channel_messages')
    OR (p_conversation->>'boxId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR NULLIF(btrim(v_provider),'') IS NULL THEN RAISE EXCEPTION 'invalid_configuration' USING ERRCODE='22023'; END IF;
  v_box:=(p_conversation->>'boxId')::uuid;
  IF v_storage='whatsapp_messages' AND NOT EXISTS (SELECT 1 FROM public.whatsapp_instances w
    WHERE w.id=v_box AND w.organization_id=p_organization_id AND lower(COALESCE(NULLIF(w.provider,''),'uazapi'))=lower(v_provider))
  THEN RAISE EXCEPTION 'context_unavailable' USING ERRCODE='PT404'; END IF;
  IF v_storage='channel_messages' AND NOT EXISTS (
    SELECT 1 FROM public.whatsapp_instances w WHERE w.id=v_box AND w.organization_id=p_organization_id AND lower(COALESCE(NULLIF(w.provider,''),'uazapi'))=lower(v_provider)
    UNION ALL SELECT 1 FROM public.messaging_channels c WHERE c.id=v_box AND c.organization_id=p_organization_id AND lower(c.provider)=lower(v_provider))
  THEN RAISE EXCEPTION 'context_unavailable' USING ERRCODE='PT404'; END IF;
  IF v_storage='whatsapp_messages' OR EXISTS (SELECT 1 FROM public.whatsapp_instances WHERE id=v_box AND organization_id=p_organization_id) THEN
    SELECT public.normalize_brazilian_phone(l.phone) INTO v_participant FROM public.leads l
      WHERE l.id=p_lead_id AND l.organization_id=p_organization_id AND l.deleted_at IS NULL;
  ELSE
    SELECT i.external_user_id INTO v_participant FROM public.lead_social_identities i
      WHERE i.organization_id=p_organization_id AND i.lead_id=p_lead_id AND i.messaging_channel_id=v_box AND lower(i.provider)=lower(v_provider);
  END IF;
  IF NULLIF(v_participant,'') IS NULL THEN RAISE EXCEPTION 'context_unavailable' USING ERRCODE='PT404'; END IF;
  IF v_storage='whatsapp_messages' THEN
    SELECT m.id,m.timestamp INTO v_match,v_match_at FROM public.whatsapp_messages m
      WHERE m.organization_id=p_organization_id AND m.deleted_at IS NULL AND m.direction='incoming'
        AND m.instance_id=ANY(public.whatsapp_chip_instance_ids(p_organization_id,v_box))
        AND public.normalize_brazilian_phone(m.phone_number)=v_participant AND m.timestamp>=p_from AND m.timestamp<p_to
      ORDER BY m.timestamp,m.id LIMIT 1;
  ELSE
    SELECT m.id,m.timestamp INTO v_match,v_match_at FROM public.channel_messages m
      WHERE m.organization_id=p_organization_id AND m.direction='incoming' AND COALESCE(m.instance_id,m.messaging_channel_id)=v_box
        AND (CASE WHEN m.instance_id IS NOT NULL THEN public.normalize_brazilian_phone(m.phone_number) ELSE m.contact_external_id END)=v_participant
        AND m.timestamp>=p_from AND m.timestamp<p_to ORDER BY m.timestamp,m.id LIMIT 1;
  END IF;
  SELECT CASE WHEN latest.state='complete' AND latest.covered_from<=p_from AND latest.covered_to>=p_to THEN 'complete'
    WHEN latest.state='in_progress' THEN 'in_progress' ELSE 'gapped' END INTO v_coverage
  FROM (SELECT c.state,c.covered_from,c.covered_to FROM public.conversation_history_coverage c
    WHERE c.organization_id=p_organization_id AND c.storage=v_storage AND c.box_id=v_box
      AND lower(c.provider)=lower(v_provider) AND c.participant_id=v_participant
      AND c.covered_from<p_to AND c.covered_to>p_from
    ORDER BY c.observed_at DESC,c.id DESC LIMIT 1) latest;
  v_coverage:=COALESCE(v_coverage,'gapped');
  RETURN jsonb_build_object('matched_message_id',v_match,'matched_at',v_match_at,'coverage_status',v_coverage);
END; $$;
REVOKE ALL ON FUNCTION public.guided_message_period_payload(uuid,uuid,jsonb,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.guided_message_period_payload(uuid,uuid,jsonb,timestamptz,timestamptz) TO authenticated,service_role;

CREATE FUNCTION public.test_guided_condition_message_period(p_organization_id uuid,p_lead_id uuid,p_conversation jsonb,p_from timestamptz,p_to timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$
BEGIN IF auth.uid() IS NULL THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
RETURN public.guided_message_period_payload(p_organization_id,p_lead_id,p_conversation,p_from,p_to); END; $$;
REVOKE ALL ON FUNCTION public.test_guided_condition_message_period(uuid,uuid,jsonb,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.test_guided_condition_message_period(uuid,uuid,jsonb,timestamptz,timestamptz) TO authenticated;

CREATE FUNCTION public.read_guided_condition_message_period(p_workflow_id uuid,p_organization_id uuid,p_lead_id uuid,p_conversation jsonb,p_from timestamptz,p_to timestamptz)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.workflows w JOIN public.workflow_data_grants g ON g.workflow_id=w.id AND g.organization_id=w.organization_id
    WHERE w.id=p_workflow_id AND w.organization_id=p_organization_id AND g.resource_scope='organization_leads'
      AND ARRAY['message.period.exists']::text[]<@g.fields AND NOT public.org_access_blocked(w.organization_id) FOR SHARE OF w,g;
  IF NOT FOUND THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
  RETURN public.guided_message_period_payload(p_organization_id,p_lead_id,p_conversation,p_from,p_to);
END; $$;
REVOKE ALL ON FUNCTION public.read_guided_condition_message_period(uuid,uuid,uuid,jsonb,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_guided_condition_message_period(uuid,uuid,uuid,jsonb,timestamptz,timestamptz) TO service_role;

CREATE FUNCTION public.validate_guided_message_period_version() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_invalid text[];
BEGIN
  WITH RECURSIVE conditions(node_id,condition) AS (
    SELECT node->>'id',node->'data'->'guidedCondition' FROM jsonb_array_elements(NEW.definition->'nodes') node WHERE node->>'type'='condition'
    UNION ALL SELECT conditions.node_id,child FROM conditions CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN conditions.condition->>'kind'='group' THEN conditions.condition->'children' ELSE '[]'::jsonb END) child
  ) SELECT array_agg(DISTINCT node_id ORDER BY node_id) FILTER (WHERE NOT (
    condition->>'operator'=ANY(ARRAY['exists','not_exists']) AND (condition->>'from')::timestamptz<(condition->>'to')::timestamptz
    AND (condition->>'to')::timestamptz-(condition->>'from')::timestamptz<=interval '366 days'
    AND (condition->'conversation'->>'kind'='trigger' OR (condition->'conversation'->>'kind'='explicit'
      AND condition->'conversation'->>'storage'=ANY(ARRAY['whatsapp_messages','channel_messages'])
      AND condition->'conversation'->>'boxId'~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND NULLIF(condition->'conversation'->>'provider','') IS NOT NULL)))) INTO v_invalid
    FROM conditions WHERE condition->>'field'='message.period.exists';
  IF cardinality(v_invalid)>0 THEN RAISE EXCEPTION 'invalid_configuration' USING ERRCODE='22023',DETAIL=jsonb_build_object('nodeIds',v_invalid)::text; END IF;
  IF (WITH RECURSIVE conditions(condition) AS (
    SELECT node->'data'->'guidedCondition' FROM jsonb_array_elements(NEW.definition->'nodes') node WHERE node->>'type'='condition'
    UNION ALL SELECT child FROM conditions CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN condition->>'kind'='group' THEN condition->'children' ELSE '[]'::jsonb END) child)
    SELECT count(*) FROM conditions WHERE condition->>'field'='message.period.exists')>20
  THEN RAISE EXCEPTION 'invalid_configuration' USING ERRCODE='22023'; END IF;
  IF EXISTS (WITH RECURSIVE conditions(condition) AS (
    SELECT node->'data'->'guidedCondition' FROM jsonb_array_elements(NEW.definition->'nodes') node WHERE node->>'type'='condition'
    UNION ALL SELECT child FROM conditions CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN condition->>'kind'='group' THEN condition->'children' ELSE '[]'::jsonb END) child)
    SELECT 1 FROM conditions WHERE condition->>'field'='message.period.exists' AND NOT ('message.period.exists'=ANY(NEW.required_fields)))
  THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
  RETURN NEW;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
  RAISE EXCEPTION 'invalid_configuration' USING ERRCODE='22023';
END; $$;
REVOKE ALL ON FUNCTION public.validate_guided_message_period_version() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER validate_guided_message_period_version BEFORE INSERT OR UPDATE OF definition,required_fields
  ON public.workflow_guided_versions FOR EACH ROW EXECUTE FUNCTION public.validate_guided_message_period_version();

NOTIFY pgrst,'reload schema';
COMMIT;
