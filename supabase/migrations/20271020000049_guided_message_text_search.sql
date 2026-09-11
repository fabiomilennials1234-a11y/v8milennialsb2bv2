-- Multi-expression message search with one-message semantics and provenance.
BEGIN;

CREATE FUNCTION public.guided_normalize_message_search(p_value text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT SET search_path=public AS $$
  SELECT btrim(regexp_replace(translate(lower(normalize(p_value,NFD)),
    U&'\0300\0301\0302\0303\0308\0327',''),'[^a-z0-9]+',' ','g'));
$$;
REVOKE ALL ON FUNCTION public.guided_normalize_message_search(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.guided_normalize_message_search(text) TO authenticated,service_role;

CREATE FUNCTION public.guided_message_search_matches(p_text text,p_expressions text[],p_match_mode text,p_expression_match text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT SET search_path=public AS $$
  SELECT CASE p_expression_match WHEN 'all' THEN bool_and(hit) ELSE bool_or(hit) END FROM (
    SELECT CASE p_match_mode WHEN 'substring' THEN public.guided_normalize_message_search(p_text) LIKE '%'||public.guided_normalize_message_search(expression)||'%'
      ELSE (' '||public.guided_normalize_message_search(p_text)||' ') LIKE '% '||public.guided_normalize_message_search(expression)||' %' END hit
    FROM unnest(p_expressions) expression
  ) matches;
$$;
REVOKE ALL ON FUNCTION public.guided_message_search_matches(text,text[],text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.guided_message_search_matches(text,text[],text,text) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.valid_guided_data_scopes(p_fields text[])
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path=public AS $$
  SELECT p_fields IS NOT NULL AND cardinality(p_fields)<=256 AND coalesce(array_ndims(p_fields),1)=1
    AND NOT EXISTS (SELECT 1 FROM unnest(p_fields) requested(scope) WHERE scope IS NULL OR NOT (
      scope=ANY(ARRAY['lead.name','lead.company','lead.email','lead.phone','lead.qualification_score','lead.utm_campaign','lead.utm_source','lead.utm_medium','lead.utm_content','lead.utm_term','lead.segment','lead.urgency','lead.faturamento','lead.tags','lead.origin','lead.pre_sale_responsible_id','lead.sale_responsible_id','business.trigger.stage','business.trigger.value','business.trigger.stage_elapsed','business.exists.lifecycle','business.exists.stage','business.exists.value','business.last_won_date','message.trigger.text','message.period.exists','message.search.text']::text[])
      OR scope~'^lead\.custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'));
$$;
REVOKE ALL ON FUNCTION public.valid_guided_data_scopes(text[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.valid_guided_data_scopes(text[]) TO authenticated,service_role;

CREATE FUNCTION public.guided_message_search_payload(p_organization_id uuid,p_lead_id uuid,p_conversation jsonb,p_source jsonb,
  p_expressions text[],p_match_mode text,p_expression_match text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$
DECLARE v_storage text:=p_conversation->>'storage'; v_box uuid; v_provider text:=p_conversation->>'provider'; v_participant text;
  v_from timestamptz; v_to timestamptz:=statement_timestamp(); v_row record; v_coverage text:='gapped';
BEGIN
  IF v_storage NOT IN ('whatsapp_messages','channel_messages') OR (p_conversation->>'boxId')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR NULLIF(btrim(v_provider),'') IS NULL OR p_match_mode NOT IN ('whole_phrase','substring') OR p_expression_match NOT IN ('any','all')
    OR cardinality(p_expressions) NOT BETWEEN 1 AND 20 OR EXISTS(SELECT 1 FROM unnest(p_expressions)e WHERE NULLIF(public.guided_normalize_message_search(e),'') IS NULL OR length(e)>120)
    OR (SELECT count(DISTINCT public.guided_normalize_message_search(e)) FROM unnest(p_expressions)e)<>cardinality(p_expressions)
    OR (SELECT coalesce(sum(length(public.guided_normalize_message_search(e))),0) FROM unnest(p_expressions)e)>1000
    OR p_source->>'kind' NOT IN ('last_received','period') THEN RAISE EXCEPTION 'invalid_configuration' USING ERRCODE='22023'; END IF;
  v_box:=(p_conversation->>'boxId')::uuid;
  IF v_storage='whatsapp_messages' AND NOT EXISTS(SELECT 1 FROM public.whatsapp_instances w WHERE w.id=v_box AND w.organization_id=p_organization_id AND lower(COALESCE(NULLIF(w.provider,''),'uazapi'))=lower(v_provider))
    THEN RAISE EXCEPTION 'context_unavailable' USING ERRCODE='PT404'; END IF;
  IF v_storage='channel_messages' AND NOT EXISTS(SELECT 1 FROM public.whatsapp_instances w WHERE w.id=v_box AND w.organization_id=p_organization_id AND lower(COALESCE(NULLIF(w.provider,''),'uazapi'))=lower(v_provider)
    UNION ALL SELECT 1 FROM public.messaging_channels c WHERE c.id=v_box AND c.organization_id=p_organization_id AND lower(c.provider)=lower(v_provider))
    THEN RAISE EXCEPTION 'context_unavailable' USING ERRCODE='PT404'; END IF;
  IF v_storage='whatsapp_messages' OR EXISTS(SELECT 1 FROM public.whatsapp_instances WHERE id=v_box AND organization_id=p_organization_id) THEN
    SELECT public.normalize_brazilian_phone(l.phone) INTO v_participant FROM public.leads l WHERE l.id=p_lead_id AND l.organization_id=p_organization_id AND l.deleted_at IS NULL;
  ELSE SELECT i.external_user_id INTO v_participant FROM public.lead_social_identities i WHERE i.organization_id=p_organization_id AND i.lead_id=p_lead_id AND i.messaging_channel_id=v_box AND lower(i.provider)=lower(v_provider); END IF;
  IF NULLIF(v_participant,'') IS NULL THEN RAISE EXCEPTION 'context_unavailable' USING ERRCODE='PT404'; END IF;
  IF p_source->>'kind'='period' THEN
    BEGIN v_from:=(p_source->>'from')::timestamptz; v_to:=(p_source->>'to')::timestamptz;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RAISE EXCEPTION 'invalid_configuration' USING ERRCODE='22023'; END;
    IF v_from>=v_to OR v_to-v_from>interval '366 days' THEN RAISE EXCEPTION 'invalid_configuration' USING ERRCODE='22023'; END IF;
  ELSE v_from:='epoch'::timestamptz; END IF;

  IF v_storage='whatsapp_messages' THEN
    SELECT m.id,m.timestamp,COALESCE(NULLIF(m.condition_text,''),NULLIF(m.transcription_text,'')) text_value,
      CASE WHEN NULLIF(m.condition_text,'') IS NOT NULL THEN m.condition_text_source WHEN NULLIF(m.transcription_text,'') IS NOT NULL THEN 'transcription' END text_source,
      CASE WHEN NULLIF(m.condition_text,'') IS NOT NULL THEN COALESCE(NULLIF(w.provider,''),'uazapi') ELSE m.transcription_provider END text_provider,
      COALESCE(NULLIF(w.provider,''),'uazapi') provider,w.id box_id,public.normalize_brazilian_phone(m.phone_number) participant_id,m.message_type
    INTO v_row FROM public.whatsapp_messages m JOIN public.whatsapp_instances w ON w.id=v_box AND w.organization_id=p_organization_id
    WHERE m.organization_id=p_organization_id AND m.deleted_at IS NULL AND m.direction='incoming' AND m.instance_id=ANY(public.whatsapp_chip_instance_ids(p_organization_id,v_box))
      AND public.normalize_brazilian_phone(m.phone_number)=v_participant AND m.timestamp>=v_from AND m.timestamp<v_to
      AND (p_source->>'kind'='last_received' OR (COALESCE(NULLIF(m.condition_text,''),NULLIF(m.transcription_text,'')) IS NOT NULL
        AND public.guided_message_search_matches(COALESCE(NULLIF(m.condition_text,''),NULLIF(m.transcription_text,'')),p_expressions,p_match_mode,p_expression_match)))
    ORDER BY CASE WHEN p_source->>'kind'='last_received' THEN m.timestamp END DESC,m.timestamp,m.id LIMIT 1;
  ELSE
    SELECT m.id,m.timestamp,COALESCE(NULLIF(m.condition_text,''),NULLIF(m.transcription_text,'')) text_value,
      CASE WHEN NULLIF(m.condition_text,'') IS NOT NULL THEN m.condition_text_source WHEN NULLIF(m.transcription_text,'') IS NOT NULL THEN 'transcription' END text_source,
      CASE WHEN NULLIF(m.condition_text,'') IS NOT NULL THEN COALESCE(w.provider,c.provider) ELSE m.transcription_provider END text_provider,
      COALESCE(w.provider,c.provider) provider,COALESCE(m.instance_id,m.messaging_channel_id) box_id,
      CASE WHEN m.instance_id IS NOT NULL THEN public.normalize_brazilian_phone(m.phone_number) ELSE m.contact_external_id END participant_id,m.message_type
    INTO v_row FROM public.channel_messages m LEFT JOIN public.whatsapp_instances w ON w.id=m.instance_id AND w.organization_id=p_organization_id
      LEFT JOIN public.messaging_channels c ON c.id=m.messaging_channel_id AND c.organization_id=p_organization_id
    WHERE m.organization_id=p_organization_id AND m.direction='incoming' AND COALESCE(m.instance_id,m.messaging_channel_id)=v_box
      AND (CASE WHEN m.instance_id IS NOT NULL THEN public.normalize_brazilian_phone(m.phone_number) ELSE m.contact_external_id END)=v_participant
      AND m.timestamp>=v_from AND m.timestamp<v_to AND (p_source->>'kind'='last_received' OR (COALESCE(NULLIF(m.condition_text,''),NULLIF(m.transcription_text,'')) IS NOT NULL
        AND public.guided_message_search_matches(COALESCE(NULLIF(m.condition_text,''),NULLIF(m.transcription_text,'')),p_expressions,p_match_mode,p_expression_match)))
    ORDER BY CASE WHEN p_source->>'kind'='last_received' THEN m.timestamp END DESC,m.timestamp,m.id LIMIT 1;
  END IF;
  IF p_source->>'kind'='last_received' AND v_row.id IS NOT NULL AND v_row.text_value IS NOT NULL
    AND NOT public.guided_message_search_matches(v_row.text_value,p_expressions,p_match_mode,p_expression_match) THEN v_row.id:=NULL; END IF;
  SELECT CASE WHEN latest.state='complete' AND (p_source->>'kind'='last_received' OR (latest.covered_from<=v_from AND latest.covered_to>=v_to)) THEN 'complete'
    WHEN latest.state='in_progress' THEN 'in_progress' ELSE 'gapped' END INTO v_coverage FROM (
      SELECT c.state,c.covered_from,c.covered_to FROM public.conversation_history_coverage c WHERE c.organization_id=p_organization_id AND c.storage=v_storage
        AND c.box_id=v_box AND lower(c.provider)=lower(v_provider) AND c.participant_id=v_participant AND c.covered_from<v_to AND c.covered_to>v_from
      ORDER BY c.observed_at DESC,c.id DESC LIMIT 1) latest;
  v_coverage:=COALESCE(v_coverage,'gapped');
  RETURN jsonb_build_object('matched_message_id',v_row.id,'matched_at',v_row.timestamp,'matched_text',v_row.text_value,
    'text_source',v_row.text_source,'text_provider',v_row.text_provider,'provider',v_row.provider,'box_id',v_row.box_id,'participant_id',v_row.participant_id,
    'text_state',CASE WHEN p_source->>'kind'='last_received' AND v_row.id IS NOT NULL AND v_row.text_value IS NULL
      AND v_row.message_type=ANY(ARRAY['audio','ptt','image','video','document','sticker']) THEN 'media_without_text' ELSE 'available' END,
    'coverage_status',v_coverage);
END; $$;
REVOKE ALL ON FUNCTION public.guided_message_search_payload(uuid,uuid,jsonb,jsonb,text[],text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.guided_message_search_payload(uuid,uuid,jsonb,jsonb,text[],text,text) TO authenticated,service_role;

CREATE FUNCTION public.test_guided_condition_message_search(p_organization_id uuid,p_lead_id uuid,p_conversation jsonb,p_source jsonb,p_expressions text[],p_match_mode text,p_expression_match text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$ BEGIN
IF auth.uid() IS NULL THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
RETURN public.guided_message_search_payload(p_organization_id,p_lead_id,p_conversation,p_source,p_expressions,p_match_mode,p_expression_match); END; $$;
REVOKE ALL ON FUNCTION public.test_guided_condition_message_search(uuid,uuid,jsonb,jsonb,text[],text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.test_guided_condition_message_search(uuid,uuid,jsonb,jsonb,text[],text,text) TO authenticated;

CREATE FUNCTION public.read_guided_condition_message_search(p_workflow_id uuid,p_organization_id uuid,p_lead_id uuid,p_conversation jsonb,p_source jsonb,p_expressions text[],p_match_mode text,p_expression_match text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$ BEGIN
IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
PERFORM 1 FROM public.workflows w JOIN public.workflow_data_grants g ON g.workflow_id=w.id AND g.organization_id=w.organization_id
 WHERE w.id=p_workflow_id AND w.organization_id=p_organization_id AND g.resource_scope='organization_leads' AND ARRAY['message.search.text']::text[]<@g.fields
 AND NOT public.org_access_blocked(w.organization_id) FOR SHARE OF w,g;
IF NOT FOUND THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
RETURN public.guided_message_search_payload(p_organization_id,p_lead_id,p_conversation,p_source,p_expressions,p_match_mode,p_expression_match); END; $$;
REVOKE ALL ON FUNCTION public.read_guided_condition_message_search(uuid,uuid,uuid,jsonb,jsonb,text[],text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_guided_condition_message_search(uuid,uuid,uuid,jsonb,jsonb,text[],text,text) TO service_role;

CREATE FUNCTION public.valid_guided_message_search_rule(p_condition jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path=public AS $$
DECLARE v_from timestamptz; v_to timestamptz; v_expressions text[];
BEGIN
  IF jsonb_typeof(p_condition->'expressions') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF (p_condition->>'operator'=ANY(ARRAY['matches','not_matches'])
    AND p_condition->>'expressionMatch'=ANY(ARRAY['any','all'])
    AND p_condition->>'matchMode'=ANY(ARRAY['whole_phrase','substring'])
    AND jsonb_array_length(p_condition->'expressions') BETWEEN 1 AND 20
    AND p_condition->'source'->>'kind'=ANY(ARRAY['trigger','last_received','period'])
    AND (p_condition->'conversation'->>'kind'='trigger' OR
      (p_condition->'conversation'->>'kind'='explicit'
       AND p_condition->'conversation'->>'storage'=ANY(ARRAY['whatsapp_messages','channel_messages'])
       AND p_condition->'conversation'->>'boxId'~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND NULLIF(btrim(p_condition->'conversation'->>'provider'),'') IS NOT NULL))
    AND (p_condition->'source'->>'kind'<>'trigger' OR p_condition->'conversation'->>'kind'='trigger')) IS NOT TRUE THEN RETURN false; END IF;
  SELECT array_agg(value ORDER BY ordinal) INTO v_expressions
  FROM jsonb_array_elements_text(p_condition->'expressions') WITH ORDINALITY expression(value,ordinal);
  IF EXISTS(SELECT 1 FROM unnest(v_expressions)e WHERE NULLIF(public.guided_normalize_message_search(e),'') IS NULL OR length(e)>120)
    OR (SELECT count(DISTINCT public.guided_normalize_message_search(e)) FROM unnest(v_expressions)e)<>cardinality(v_expressions)
    OR (SELECT coalesce(sum(length(public.guided_normalize_message_search(e))),0) FROM unnest(v_expressions)e)>1000 THEN RETURN false; END IF;
  IF p_condition->'source'->>'kind'='period' THEN
    BEGIN v_from:=(p_condition->'source'->>'from')::timestamptz; v_to:=(p_condition->'source'->>'to')::timestamptz;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false; END;
    IF v_from>=v_to OR v_to-v_from>interval '366 days' THEN RETURN false; END IF;
  END IF;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END; $$;
REVOKE ALL ON FUNCTION public.valid_guided_message_search_rule(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.validate_guided_message_search_version() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_invalid text[];
BEGIN
  WITH RECURSIVE conditions(node_id,condition) AS (SELECT node->>'id',node->'data'->'guidedCondition' FROM jsonb_array_elements(NEW.definition->'nodes')node WHERE node->>'type'='condition'
    UNION ALL SELECT conditions.node_id,child FROM conditions CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN conditions.condition->>'kind'='group' THEN conditions.condition->'children' ELSE '[]'::jsonb END)child)
  SELECT array_agg(DISTINCT node_id ORDER BY node_id) FILTER(WHERE NOT public.valid_guided_message_search_rule(condition)) INTO v_invalid
  FROM conditions WHERE condition->>'field'='message.search.text';
  IF cardinality(v_invalid)>0 THEN RAISE EXCEPTION 'invalid_configuration' USING ERRCODE='22023',DETAIL=jsonb_build_object('nodeIds',v_invalid)::text; END IF;
  IF (WITH RECURSIVE conditions(condition) AS (SELECT node->'data'->'guidedCondition' FROM jsonb_array_elements(NEW.definition->'nodes')node WHERE node->>'type'='condition'
    UNION ALL SELECT child FROM conditions CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN condition->>'kind'='group' THEN condition->'children' ELSE '[]'::jsonb END)child)
    SELECT count(*) FROM conditions WHERE condition->>'field'='message.search.text')>20
  THEN RAISE EXCEPTION 'invalid_configuration' USING ERRCODE='22023'; END IF;
  IF EXISTS(WITH RECURSIVE conditions(condition) AS (SELECT node->'data'->'guidedCondition' FROM jsonb_array_elements(NEW.definition->'nodes')node WHERE node->>'type'='condition'
    UNION ALL SELECT child FROM conditions CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN condition->>'kind'='group' THEN condition->'children' ELSE '[]'::jsonb END)child)
    SELECT 1 FROM conditions WHERE condition->>'field'='message.search.text' AND NOT('message.search.text'=ANY(NEW.required_fields)))
  THEN RAISE EXCEPTION 'access_denied' USING ERRCODE='42501'; END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.validate_guided_message_search_version() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER validate_guided_message_search_version BEFORE INSERT OR UPDATE OF definition,required_fields ON public.workflow_guided_versions
FOR EACH ROW EXECUTE FUNCTION public.validate_guided_message_search_version();
NOTIFY pgrst,'reload schema';
COMMIT;
