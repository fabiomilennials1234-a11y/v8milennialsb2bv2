-- Wall-clock elapsed time for the current unanswered conversation sequence.
BEGIN;

CREATE OR REPLACE FUNCTION public.valid_guided_data_scopes(p_fields text[])
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path=public AS $$
  SELECT p_fields IS NOT NULL AND cardinality(p_fields)<=256 AND coalesce(array_ndims(p_fields),1)=1
    AND NOT EXISTS (SELECT 1 FROM unnest(p_fields) requested(scope) WHERE scope IS NULL OR NOT (
      scope=ANY(ARRAY['lead.name','lead.company','lead.email','lead.phone','lead.qualification_score','lead.utm_campaign','lead.utm_source','lead.utm_medium','lead.utm_content','lead.utm_term','lead.segment','lead.urgency','lead.faturamento','lead.tags','lead.origin','lead.pre_sale_responsible_id','lead.sale_responsible_id','business.trigger.stage','business.trigger.value','business.trigger.stage_elapsed','business.exists.lifecycle','business.exists.stage','business.exists.value','business.last_won_date','message.trigger.text','message.period.exists','message.search.text','message.waiting.elapsed']::text[])
      OR scope~'^lead\.custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'));
$$;
REVOKE ALL ON FUNCTION public.valid_guided_data_scopes(text[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.valid_guided_data_scopes(text[]) TO authenticated,service_role;

CREATE FUNCTION public.guided_message_waiting_payload(p_organization_id uuid,p_lead_id uuid,p_conversation jsonb,p_waiting_for text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$
DECLARE v_storage text:=p_conversation->>'storage'; v_box uuid; v_provider text:=p_conversation->>'provider'; v_participant text;
  v_expected_direction text; v_latest_direction text; v_boundary timestamptz; v_anchor_id uuid; v_anchor_at timestamptz;
  v_coverage text:='gapped'; v_now timestamptz:=statement_timestamp();
BEGIN
  IF v_storage NOT IN ('whatsapp_messages','channel_messages') OR (p_conversation->>'boxId')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR NULLIF(btrim(v_provider),'') IS NULL OR p_waiting_for NOT IN ('lead','company')
  THEN RAISE EXCEPTION 'invalid_configuration' USING ERRCODE='22023'; END IF;
  v_box:=(p_conversation->>'boxId')::uuid;
  IF v_storage='whatsapp_messages' AND NOT EXISTS(SELECT 1 FROM public.whatsapp_instances w WHERE w.id=v_box AND w.organization_id=p_organization_id
    AND lower(COALESCE(NULLIF(w.provider,''),'uazapi'))=lower(v_provider)) THEN RAISE EXCEPTION 'context_unavailable' USING ERRCODE='PT404'; END IF;
  IF v_storage='channel_messages' AND NOT EXISTS(SELECT 1 FROM public.whatsapp_instances w WHERE w.id=v_box AND w.organization_id=p_organization_id
    AND lower(COALESCE(NULLIF(w.provider,''),'uazapi'))=lower(v_provider) UNION ALL SELECT 1 FROM public.messaging_channels c
    WHERE c.id=v_box AND c.organization_id=p_organization_id AND lower(c.provider)=lower(v_provider))
  THEN RAISE EXCEPTION 'context_unavailable' USING ERRCODE='PT404'; END IF;
  IF v_storage='whatsapp_messages' OR EXISTS(SELECT 1 FROM public.whatsapp_instances WHERE id=v_box AND organization_id=p_organization_id) THEN
    SELECT public.normalize_brazilian_phone(l.phone) INTO v_participant FROM public.leads l
    WHERE l.id=p_lead_id AND l.organization_id=p_organization_id AND l.deleted_at IS NULL;
  ELSE SELECT i.external_user_id INTO v_participant FROM public.lead_social_identities i
    WHERE i.organization_id=p_organization_id AND i.lead_id=p_lead_id AND i.messaging_channel_id=v_box AND lower(i.provider)=lower(v_provider); END IF;
  IF NULLIF(v_participant,'') IS NULL THEN RAISE EXCEPTION 'context_unavailable' USING ERRCODE='PT404'; END IF;
  -- `waiting_for` nomeia quem espera: lead falou (incoming) e espera a empresa;
  -- empresa falou (outgoing) e espera o lead.
  v_expected_direction:=CASE p_waiting_for WHEN 'lead' THEN 'incoming' ELSE 'outgoing' END;

  IF v_storage='whatsapp_messages' THEN
    WITH eligible AS (
      SELECT m.id,m.timestamp,m.direction FROM public.whatsapp_messages m
      WHERE m.organization_id=p_organization_id AND m.deleted_at IS NULL AND m.is_group=false
        AND m.instance_id=ANY(public.whatsapp_chip_instance_ids(p_organization_id,v_box))
        AND (m.normalized_phone=v_participant OR (m.normalized_phone IS NULL AND public.normalize_brazilian_phone(m.phone_number)=v_participant))
        AND m.timestamp<=v_now
        AND m.message_type<>ALL(ARRAY['receipt','reaction','protocol','notification','system']::text[])
        AND ((m.direction='incoming' AND m.status='received') OR (m.direction='outgoing' AND m.status=ANY(ARRAY['sent','delivered','read']::text[])))
    ), latest AS (SELECT direction FROM eligible ORDER BY timestamp DESC,id DESC LIMIT 1),
    boundary AS (SELECT max(timestamp) at FROM eligible WHERE direction<>v_expected_direction),
    anchor AS (SELECT id,timestamp FROM eligible WHERE direction=v_expected_direction
      AND timestamp>COALESCE((SELECT at FROM boundary),'-infinity'::timestamptz) ORDER BY timestamp,id LIMIT 1)
    SELECT (SELECT direction FROM latest),(SELECT at FROM boundary),(SELECT id FROM anchor),(SELECT timestamp FROM anchor)
      INTO v_latest_direction,v_boundary,v_anchor_id,v_anchor_at;
  ELSE
    WITH eligible AS (
      SELECT m.id,m.timestamp,m.direction FROM public.channel_messages m
      WHERE m.organization_id=p_organization_id AND COALESCE(m.instance_id,m.messaging_channel_id)=v_box
        AND (CASE WHEN m.instance_id IS NOT NULL THEN public.normalize_brazilian_phone(m.phone_number) ELSE m.contact_external_id END)=v_participant
        AND m.timestamp<=v_now AND m.message_type<>ALL(ARRAY['receipt','reaction','protocol','notification','system']::text[])
        AND ((m.direction='incoming' AND m.status='received') OR (m.direction='outgoing' AND m.status=ANY(ARRAY['sent','delivered','read']::text[])))
    ), latest AS (SELECT direction FROM eligible ORDER BY timestamp DESC,id DESC LIMIT 1),
    boundary AS (SELECT max(timestamp) at FROM eligible WHERE direction<>v_expected_direction),
    anchor AS (SELECT id,timestamp FROM eligible WHERE direction=v_expected_direction
      AND timestamp>COALESCE((SELECT at FROM boundary),'-infinity'::timestamptz) ORDER BY timestamp,id LIMIT 1)
    SELECT (SELECT direction FROM latest),(SELECT at FROM boundary),(SELECT id FROM anchor),(SELECT timestamp FROM anchor)
      INTO v_latest_direction,v_boundary,v_anchor_id,v_anchor_at;
  END IF;

  SELECT CASE latest.state WHEN 'complete' THEN 'complete' WHEN 'in_progress' THEN 'in_progress' ELSE 'gapped' END INTO v_coverage
  FROM (SELECT c.state FROM public.conversation_history_coverage c WHERE c.organization_id=p_organization_id AND c.storage=v_storage
    AND c.box_id=v_box AND lower(c.provider)=lower(v_provider) AND c.participant_id=v_participant
    ORDER BY c.observed_at DESC,c.id DESC LIMIT 1) latest;
  v_coverage:=COALESCE(v_coverage,'gapped');
  IF v_latest_direction IS DISTINCT FROM v_expected_direction THEN v_anchor_id:=NULL; v_anchor_at:=NULL; END IF;
  RETURN jsonb_build_object('waiting',v_anchor_id IS NOT NULL,'elapsed_seconds',CASE WHEN v_anchor_at IS NULL THEN NULL ELSE extract(epoch FROM v_now-v_anchor_at) END,
    'anchor_message_id',v_anchor_id,'anchor_at',v_anchor_at,'direction',CASE WHEN v_anchor_id IS NULL THEN NULL ELSE v_expected_direction END,
    'provider',v_provider,'box_id',v_box,'participant_id',v_participant,'coverage_status',v_coverage);
END; $$;
REVOKE ALL ON FUNCTION public.guided_message_waiting_payload(uuid,uuid,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.guided_message_waiting_payload(uuid,uuid,jsonb,text) TO authenticated,service_role;

CREATE FUNCTION public.test_guided_condition_message_waiting(p_organization_id uuid,p_lead_id uuid,p_conversation jsonb,p_waiting_for text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$
BEGIN IF auth.uid() IS NULL THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
RETURN public.guided_message_waiting_payload(p_organization_id,p_lead_id,p_conversation,p_waiting_for); END; $$;
REVOKE ALL ON FUNCTION public.test_guided_condition_message_waiting(uuid,uuid,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.test_guided_condition_message_waiting(uuid,uuid,jsonb,text) TO authenticated;

CREATE FUNCTION public.read_guided_condition_message_waiting(p_workflow_id uuid,p_organization_id uuid,p_lead_id uuid,p_conversation jsonb,p_waiting_for text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.workflows w JOIN public.workflow_data_grants g ON g.workflow_id=w.id AND g.organization_id=w.organization_id
    WHERE w.id=p_workflow_id AND w.organization_id=p_organization_id AND g.resource_scope='organization_leads'
      AND ARRAY['message.waiting.elapsed']::text[]<@g.fields AND NOT public.org_access_blocked(w.organization_id) FOR SHARE OF w,g;
  IF NOT FOUND THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
  RETURN public.guided_message_waiting_payload(p_organization_id,p_lead_id,p_conversation,p_waiting_for);
END; $$;
REVOKE ALL ON FUNCTION public.read_guided_condition_message_waiting(uuid,uuid,uuid,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_guided_condition_message_waiting(uuid,uuid,uuid,jsonb,text) TO service_role;

CREATE FUNCTION public.validate_guided_message_waiting_version() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_invalid text[];
BEGIN
  WITH RECURSIVE conditions(node_id,condition) AS (
    SELECT node->>'id',node->'data'->'guidedCondition' FROM jsonb_array_elements(NEW.definition->'nodes') node WHERE node->>'type'='condition'
    UNION ALL SELECT conditions.node_id,child FROM conditions CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN conditions.condition->>'kind'='group' THEN conditions.condition->'children' ELSE '[]'::jsonb END) child
  ) SELECT array_agg(DISTINCT node_id ORDER BY node_id) FILTER (WHERE NOT (
    condition->>'waitingFor'=ANY(ARRAY['lead','company']) AND condition->>'operator'=ANY(ARRAY['equals','not_equals','greater_than','greater_than_or_equal','less_than','less_than_or_equal'])
    AND jsonb_typeof(condition->'value')='number' AND (condition->>'value')::numeric>=0 AND condition->>'unit'=ANY(ARRAY['minutes','hours','days'])
    AND (condition->'conversation'->>'kind'='trigger' OR (condition->'conversation'->>'kind'='explicit'
      AND condition->'conversation'->>'storage'=ANY(ARRAY['whatsapp_messages','channel_messages'])
      AND condition->'conversation'->>'boxId'~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND NULLIF(condition->'conversation'->>'provider','') IS NOT NULL)))) INTO v_invalid FROM conditions WHERE condition->>'field'='message.waiting.elapsed';
  IF cardinality(v_invalid)>0 THEN RAISE EXCEPTION 'invalid_configuration' USING ERRCODE='22023',DETAIL=jsonb_build_object('nodeIds',v_invalid)::text; END IF;
  IF (WITH RECURSIVE conditions(condition) AS (SELECT node->'data'->'guidedCondition' FROM jsonb_array_elements(NEW.definition->'nodes') node WHERE node->>'type'='condition'
    UNION ALL SELECT child FROM conditions CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN condition->>'kind'='group' THEN condition->'children' ELSE '[]'::jsonb END) child)
    SELECT count(*) FROM conditions WHERE condition->>'field'='message.waiting.elapsed')>20 THEN RAISE EXCEPTION 'invalid_configuration' USING ERRCODE='22023'; END IF;
  IF EXISTS(WITH RECURSIVE conditions(condition) AS (SELECT node->'data'->'guidedCondition' FROM jsonb_array_elements(NEW.definition->'nodes') node WHERE node->>'type'='condition'
    UNION ALL SELECT child FROM conditions CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN condition->>'kind'='group' THEN condition->'children' ELSE '[]'::jsonb END) child)
    SELECT 1 FROM conditions WHERE condition->>'field'='message.waiting.elapsed' AND NOT ('message.waiting.elapsed'=ANY(NEW.required_fields)))
  THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.validate_guided_message_waiting_version() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER validate_guided_message_waiting_version BEFORE INSERT OR UPDATE OF definition,required_fields ON public.workflow_guided_versions
FOR EACH ROW EXECUTE FUNCTION public.validate_guided_message_waiting_version();

NOTIFY pgrst,'reload schema';
COMMIT;
