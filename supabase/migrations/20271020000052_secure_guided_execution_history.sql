-- Execution history is a projection, not a transfer of the worker's data grant.
-- Every read re-evaluates the caller's current workflow and lead permissions.
BEGIN;

CREATE OR REPLACE FUNCTION public.guided_execution_safe_error(p_error text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_error IS NULL OR btrim(p_error) = '' THEN NULL
    WHEN lower(p_error) LIKE '%access_denied%' THEN 'access_denied'
    WHEN lower(p_error) LIKE '%context_unavailable%' THEN 'context_unavailable'
    WHEN lower(p_error) LIKE '%reference_unavailable%' THEN 'reference_unavailable'
    WHEN lower(p_error) LIKE '%invalid_configuration%' THEN 'invalid_configuration'
    WHEN lower(p_error) LIKE '%history_insufficient%' THEN 'history_insufficient'
    WHEN lower(p_error) LIKE '%history_sync_in_progress%' THEN 'history_sync_in_progress'
    WHEN lower(p_error) LIKE '%temporarily_unavailable%' THEN 'temporarily_unavailable'
    WHEN lower(p_error) LIKE '%execution_version_unavailable%' THEN 'execution_version_unavailable'
    WHEN lower(p_error) LIKE '%loop_limit%' THEN 'loop_limit_reached'
    ELSE 'execution_failed'
  END
$$;

CREATE OR REPLACE FUNCTION public.guided_execution_safe_output(p_node_type text, p_output jsonb)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_result jsonb := '{}'::jsonb;
  v_allowed text[];
BEGIN
  IF p_output IS NULL OR jsonb_typeof(p_output) IS DISTINCT FROM 'object' THEN
    RETURN NULL;
  END IF;
  v_allowed := CASE p_node_type
    WHEN 'condition' THEN ARRAY['matched', 'version_id', 'retry_scheduled', 'retry_attempt', 'max_retries', 'retry_after_seconds']
    WHEN 'split_ab' THEN ARRAY['chosenVariant', 'reused', 'roll']
    ELSE ARRAY['retry_scheduled', 'retry_attempt', 'max_retries', 'retry_after_seconds', 'status', 'bytes']
  END;
  FOREACH v_key IN ARRAY v_allowed LOOP
    IF p_output ? v_key THEN
      v_result := v_result || jsonb_build_object(v_key, p_output -> v_key);
    END IF;
  END LOOP;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_read_guided_execution_data(
  p_organization_id uuid,
  p_lead_id uuid,
  p_version_id uuid
)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_required_fields text[];
  v_definition jsonb;
  v_box_ids uuid[];
BEGIN
  IF auth.uid() IS NULL OR p_organization_id IS NULL OR p_lead_id IS NULL OR p_version_id IS NULL THEN
    RETURN false;
  END IF;
  IF public.is_master_user() THEN
    RETURN public.can_administer_guided_workflow(p_organization_id);
  END IF;
  IF NOT public.can_link_or_read_lead(p_lead_id, p_organization_id) THEN
    RETURN false;
  END IF;

  SELECT v.required_fields, v.definition INTO v_required_fields, v_definition
  FROM public.workflow_guided_versions v
  WHERE v.id = p_version_id
    AND v.organization_id = p_organization_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF EXISTS (SELECT 1 FROM unnest(v_required_fields) f WHERE f LIKE 'business.%')
    AND NOT COALESCE(public.has_feature_permission('pipeline.view', p_organization_id), false) THEN
    RETURN false;
  END IF;

  IF EXISTS (SELECT 1 FROM unnest(v_required_fields) f WHERE f LIKE 'message.%') THEN
    IF NOT COALESCE(public.has_feature_permission('whatsapp.view', p_organization_id), false)
      OR NOT public.can_see_chat_lead(p_organization_id, p_lead_id) THEN
      RETURN false;
    END IF;
    SELECT array_agg(DISTINCT (q.value #>> '{}')::uuid)
      INTO v_box_ids
    FROM jsonb_path_query(v_definition, '$.**.boxId') AS q(value)
    WHERE jsonb_typeof(q.value) = 'string';
    IF cardinality(COALESCE(v_box_ids, ARRAY[]::uuid[])) > 0
      AND NOT v_box_ids <@ public.whatsapp_readable_instance_ids(p_organization_id, v_box_ids) THEN
      RETURN false;
    END IF;
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.pin_guided_execution_version()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_retry_version text := current_setting('app.guided_retry_version', true);
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.guided_version_id IS DISTINCT FROM OLD.guided_version_id
      OR (OLD.guided_version_id IS NOT NULL AND
        (NEW.workflow_id IS DISTINCT FROM OLD.workflow_id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id)) THEN
      RAISE EXCEPTION 'execution_version_immutable' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- Only retry_workflow_execution sets this transaction-local marker. It lets
  -- a retry keep its immutable snapshot instead of mixing an old node/context
  -- with whichever publication became active later.
  IF v_retry_version = 'legacy' AND NEW.guided_version_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF v_retry_version <> '' AND NEW.guided_version_id IS NOT NULL
    AND NEW.guided_version_id::text = v_retry_version THEN
    PERFORM 1 FROM public.workflow_guided_versions v
    WHERE v.id = NEW.guided_version_id
      AND v.workflow_id = NEW.workflow_id
      AND v.organization_id = NEW.organization_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  PERFORM 1 FROM public.workflows w WHERE w.id = NEW.workflow_id
    AND w.organization_id = NEW.organization_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501'; END IF;
  SELECT p.version_id INTO NEW.guided_version_id FROM public.workflow_guided_publications p
    WHERE p.workflow_id = NEW.workflow_id AND p.organization_id = NEW.organization_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_workflow_execution_history(
  p_workflow_id uuid,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  workflow_id uuid,
  status text,
  started_at timestamptz,
  completed_at timestamptz,
  retry_of uuid,
  guided_version_id uuid,
  version_number integer,
  version_published_at timestamptz,
  data_visible boolean,
  lead_id uuid,
  lead_name text,
  current_node_id text,
  error_code text,
  can_retry boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_organization_id uuid;
  v_can_view_workflow boolean;
  v_can_edit_workflow boolean;
BEGIN
  IF auth.uid() IS NULL OR p_workflow_id IS NULL OR p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  SELECT w.organization_id INTO v_organization_id
  FROM public.workflows w
  WHERE w.id = p_workflow_id;

  IF v_organization_id IS NULL THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  IF public.is_master_user() THEN
    -- Restricted masters deliberately fail can_administer; master status alone
    -- never grants the execution's organization data to the reader.
    v_can_view_workflow := public.can_administer_guided_workflow(v_organization_id);
  ELSE
    v_can_view_workflow := public.can_administer_guided_workflow(v_organization_id)
      OR (
        v_organization_id IN (SELECT public.get_my_organization_ids())
        AND COALESCE(public.has_feature_permission('workflows.view', v_organization_id), false)
      );
  END IF;
  IF NOT COALESCE(v_can_view_workflow, false) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  IF public.is_master_user() THEN
    v_can_edit_workflow := public.can_administer_guided_workflow(v_organization_id);
  ELSE
    v_can_edit_workflow := public.can_administer_guided_workflow(v_organization_id)
      OR COALESCE(public.has_feature_permission('workflows.edit', v_organization_id), false);
  END IF;

  RETURN QUERY
  SELECT e.id,
    e.workflow_id,
    e.status,
    e.started_at,
    e.completed_at,
    e.retry_of,
    e.guided_version_id,
    v.version_number,
    v.published_at,
    access.allowed,
    CASE WHEN access.allowed THEN e.lead_id END,
    CASE WHEN access.allowed THEN l.name END,
    CASE WHEN access.allowed THEN e.current_node_id END,
    CASE
      WHEN e.error IS NULL THEN NULL
      WHEN access.allowed THEN public.guided_execution_safe_error(e.error)
      ELSE 'protected_error'
    END,
    access.allowed AND v_can_edit_workflow AND e.status = 'failed'
  FROM public.workflow_executions e
  LEFT JOIN public.workflow_guided_versions v
    ON v.id = e.guided_version_id
   AND v.workflow_id = e.workflow_id
   AND v.organization_id = e.organization_id
  LEFT JOIN public.leads l
    ON l.id = e.lead_id
   AND l.organization_id = e.organization_id
  CROSS JOIN LATERAL (
    SELECT public.can_read_guided_execution_data(
      e.organization_id, e.lead_id, e.guided_version_id
    ) AS allowed
  ) access
  WHERE e.workflow_id = p_workflow_id
    AND e.organization_id = v_organization_id
  ORDER BY e.started_at DESC, e.id DESC
  LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_workflow_execution_steps(p_execution_id uuid)
RETURNS TABLE (
  id uuid,
  execution_id uuid,
  node_id text,
  node_type text,
  node_label text,
  status text,
  output_data jsonb,
  error_code text,
  executed_at timestamptz,
  data_visible boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_execution public.workflow_executions;
  v_can_view_workflow boolean;
  v_data_visible boolean;
BEGIN
  IF auth.uid() IS NULL OR p_execution_id IS NULL THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  SELECT e.* INTO v_execution
  FROM public.workflow_executions e
  WHERE e.id = p_execution_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  IF public.is_master_user() THEN
    v_can_view_workflow := public.can_administer_guided_workflow(v_execution.organization_id);
  ELSE
    v_can_view_workflow := public.can_administer_guided_workflow(v_execution.organization_id)
      OR (
        v_execution.organization_id IN (SELECT public.get_my_organization_ids())
        AND COALESCE(public.has_feature_permission('workflows.view', v_execution.organization_id), false)
      );
  END IF;
  IF NOT COALESCE(v_can_view_workflow, false) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  v_data_visible := public.can_read_guided_execution_data(
    v_execution.organization_id, v_execution.lead_id, v_execution.guided_version_id
  );
  IF NOT v_data_visible THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT s.id,
    s.execution_id,
    s.node_id,
    s.node_type,
    s.node_label,
    s.status,
    public.guided_execution_safe_output(s.node_type, s.output_data),
    public.guided_execution_safe_error(s.error),
    s.executed_at,
    true
  FROM public.workflow_execution_steps s
  WHERE s.execution_id = p_execution_id
  ORDER BY s.executed_at, s.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_workflow_execution_stats(p_workflow_id uuid)
RETURNS TABLE (total bigint, last_started_at timestamptz, last_status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_organization_id uuid;
BEGIN
  IF auth.uid() IS NULL OR p_workflow_id IS NULL THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  SELECT w.organization_id INTO v_organization_id
  FROM public.workflows w
  WHERE w.id = p_workflow_id;
  IF public.is_master_user() THEN
    IF v_organization_id IS NULL OR NOT public.can_administer_guided_workflow(v_organization_id) THEN
      RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
    END IF;
  ELSIF v_organization_id IS NULL OR NOT (
    public.can_administer_guided_workflow(v_organization_id)
    OR (
      v_organization_id IN (SELECT public.get_my_organization_ids())
      AND COALESCE(public.has_feature_permission('workflows.view', v_organization_id), false)
    )
  ) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT aggregate.total, latest.started_at, latest.status
  FROM (
    SELECT count(*)::bigint AS total
    FROM public.workflow_executions e
    WHERE e.workflow_id = p_workflow_id
      AND e.organization_id = v_organization_id
  ) aggregate
  LEFT JOIN LATERAL (
    SELECT e.started_at, e.status
    FROM public.workflow_executions e
    WHERE e.workflow_id = p_workflow_id
      AND e.organization_id = v_organization_id
    ORDER BY e.started_at DESC, e.id DESC
    LIMIT 1
  ) latest ON true;
END;
$$;

CREATE OR REPLACE FUNCTION public.retry_workflow_execution(p_execution_id uuid)
RETURNS TABLE (id uuid, workflow_id uuid, status text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_original public.workflow_executions;
  v_new public.workflow_executions;
  v_can_edit boolean;
BEGIN
  IF auth.uid() IS NULL OR p_execution_id IS NULL THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  SELECT e.* INTO v_original
  FROM public.workflow_executions e
  WHERE e.id = p_execution_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  IF public.is_master_user() THEN
    v_can_edit := public.can_administer_guided_workflow(v_original.organization_id);
  ELSE
    v_can_edit := public.can_administer_guided_workflow(v_original.organization_id)
      OR (
        v_original.organization_id IN (SELECT public.get_my_organization_ids())
        AND COALESCE(public.has_feature_permission('workflows.edit', v_original.organization_id), false)
      );
  END IF;
  IF NOT COALESCE(v_can_edit, false)
    OR NOT public.can_read_guided_execution_data(
      v_original.organization_id, v_original.lead_id, v_original.guided_version_id
    ) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  IF v_original.status <> 'failed' THEN
    RAISE EXCEPTION 'execution_not_retryable' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config(
    'app.guided_retry_version',
    COALESCE(v_original.guided_version_id::text, 'legacy'),
    true
  );
  INSERT INTO public.workflow_executions (
    workflow_id, organization_id, lead_id, status, current_node_id,
    loop_counters, context, retry_of, next_run_at, guided_version_id
  ) VALUES (
    v_original.workflow_id, v_original.organization_id, v_original.lead_id,
    'running', v_original.current_node_id, v_original.loop_counters,
    v_original.context, v_original.id, now(), v_original.guided_version_id
  )
  RETURNING * INTO v_new;
  PERFORM set_config('app.guided_retry_version', '', true);

  RETURN QUERY SELECT v_new.id, v_new.workflow_id, v_new.status;
END;
$$;

-- Raw rows remain available only to the worker and full masters. Restricted
-- masters, org admins and members use the projection above.
DROP POLICY IF EXISTS workflow_executions_select ON public.workflow_executions;
DROP POLICY IF EXISTS master_ghost_select_workflow_executions ON public.workflow_executions;
DROP POLICY IF EXISTS master_ghost_all_workflow_executions ON public.workflow_executions;
DROP POLICY IF EXISTS workflow_executions_full_master_all ON public.workflow_executions;
CREATE POLICY workflow_executions_full_master_all ON public.workflow_executions
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.master_users m
    WHERE m.user_id = auth.uid() AND m.is_active = true
      AND m.permissions -> 'all' = 'true'::jsonb
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.master_users m
    WHERE m.user_id = auth.uid() AND m.is_active = true
      AND m.permissions -> 'all' = 'true'::jsonb
  ));

DROP POLICY IF EXISTS workflow_execution_steps_select ON public.workflow_execution_steps;
DROP POLICY IF EXISTS master_ghost_select_workflow_execution_steps ON public.workflow_execution_steps;
DROP POLICY IF EXISTS master_ghost_all_workflow_execution_steps ON public.workflow_execution_steps;
DROP POLICY IF EXISTS workflow_execution_steps_full_master_all ON public.workflow_execution_steps;
CREATE POLICY workflow_execution_steps_full_master_all ON public.workflow_execution_steps
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.master_users m
    WHERE m.user_id = auth.uid() AND m.is_active = true
      AND m.permissions -> 'all' = 'true'::jsonb
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.master_users m
    WHERE m.user_id = auth.uid() AND m.is_active = true
      AND m.permissions -> 'all' = 'true'::jsonb
  ));

REVOKE ALL ON FUNCTION public.guided_execution_safe_error(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guided_execution_safe_output(text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.can_read_guided_execution_data(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pin_guided_execution_version() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_workflow_execution_history(uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_workflow_execution_steps(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_workflow_execution_stats(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.retry_workflow_execution(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_workflow_execution_history(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_workflow_execution_steps(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_workflow_execution_stats(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.retry_workflow_execution(uuid) TO authenticated;

-- Claim returns complete execution rows and mutates queue state. Worker only.
REVOKE ALL ON FUNCTION public.claim_workflow_executions(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_workflow_executions(integer, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
