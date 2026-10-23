-- Estado de PROD (jsjsmuncfkbsbzqzqhfq) em 23/10/2026, para o teste PGlite de
-- 20271215000000_definer_sem_gate_fecha_execucao.sql.
--
-- Corpos: pg_get_functiondef verbatim de prod (as 25 alvo + helpers de gate).
-- ACL: proacl de prod reproduzido grant a grant. Gerado, não editar à mão —
-- se prod mudar, a guarda da migration aborta e este arquivo precisa ser
-- recapturado junto com os md5 da guarda.

-- helpers de gate (prod)
CREATE OR REPLACE FUNCTION auth.role()
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$function$
;
CREATE OR REPLACE FUNCTION auth.uid()
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$function$
;
CREATE OR REPLACE FUNCTION public.get_my_gestor_organization_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT go.organization_id
  FROM public.gestor_organizations go
  JOIN public.gestores g ON g.id = go.gestor_id
  WHERE g.user_id = auth.uid()
    AND g.is_active = true;
$function$
;
CREATE OR REPLACE FUNCTION public.get_my_member_organization_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT organization_id
  FROM public.team_members
  WHERE user_id = auth.uid() AND is_active = true
  UNION
  SELECT * FROM public.get_my_gestor_organization_ids();
$function$
;
CREATE OR REPLACE FUNCTION public.get_my_organization_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT m.org_id
  FROM public.get_my_member_organization_ids() AS m(org_id)
  WHERE NOT public.org_access_blocked(m.org_id);
$function$
;
CREATE OR REPLACE FUNCTION public.is_master_user(_user_id uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.master_users
    WHERE user_id = _user_id
    AND is_active = true
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.org_access_blocked(p_org_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (
      SELECT o.subscription_status IN ('suspended', 'cancelled', 'expired')
             AND NOT COALESCE(o.billing_override, false)
      FROM public.organizations o
      WHERE o.id = p_org_id
    ),
    -- org inexistente: não é "bloqueada", é inexistente. Quem chama já trata
    -- ausência de vínculo; devolver true aqui só embaralharia os dois casos.
    false
  );
$function$
;

CREATE OR REPLACE FUNCTION public.api_create_custom_field(p_org uuid, p_field_name text, p_field_type text DEFAULT 'text'::text, p_field_options jsonb DEFAULT NULL::jsonb, p_is_required boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_nome text := btrim(COALESCE(p_field_name, ''));
  v_tipo text := COALESCE(NULLIF(btrim(COALESCE(p_field_type, '')), ''), 'text');
  v_existente record;
  v_id uuid;
BEGIN
  IF v_nome = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_name',
      'message', 'field_name é obrigatório');
  END IF;

  IF v_tipo NOT IN ('text', 'number', 'date', 'select', 'boolean') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_type',
      'message', 'field_type inválido. Válidos: text, number, date, select, boolean');
  END IF;

  -- Campo de lista sem opções seria um seletor vazio na tela.
  IF v_tipo = 'select' AND (p_field_options IS NULL OR jsonb_array_length(COALESCE(p_field_options, '[]'::jsonb)) = 0) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'options_required',
      'message', 'field_type "select" exige field_options com ao menos uma opção');
  END IF;

  SELECT id, field_name, field_type INTO v_existente
  FROM public.lead_custom_fields
  WHERE organization_id = p_org AND lower(btrim(field_name)) = lower(v_nome)
  LIMIT 1;

  IF FOUND THEN
    -- Já existe: devolve o que existe em vez de criar um gêmeo com outra caixa.
    RETURN jsonb_build_object('ok', true, 'created', false,
      'field', jsonb_build_object('id', v_existente.id, 'field_name', v_existente.field_name,
                                  'field_type', v_existente.field_type));
  END IF;

  INSERT INTO public.lead_custom_fields (organization_id, field_name, field_type, field_options, is_required)
  VALUES (p_org, v_nome, v_tipo, p_field_options, COALESCE(p_is_required, false))
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'created', true,
    'field', jsonb_build_object('id', v_id, 'field_name', v_nome, 'field_type', v_tipo));
END;
$function$;
REVOKE ALL ON FUNCTION public.api_create_custom_field(uuid,text,text,jsonb,boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_create_custom_field(uuid,text,text,jsonb,boolean) TO authenticated, service_role;  -- prod: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}

CREATE OR REPLACE FUNCTION public.api_list_team_members(p_org uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', tm.id,
    'name', tm.name,
    'email', tm.email,
    'job_title', NULLIF(btrim(COALESCE(tm.job_title, '')), ''),
    'role', tm.role,
    'is_active', tm.is_active
  ) ORDER BY tm.is_active DESC, tm.name), '[]'::jsonb)
  FROM public.team_members tm
  WHERE tm.organization_id = p_org;
$function$;
REVOKE ALL ON FUNCTION public.api_list_team_members(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_list_team_members(uuid) TO authenticated, service_role;  -- prod: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}

CREATE OR REPLACE FUNCTION public.api_set_custom_fields_creating(p_org uuid, p_lead_id uuid, p_values jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  k text;
  v_field_id uuid;
  criados text[] := '{}';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.leads
    WHERE id = p_lead_id AND organization_id = p_org AND deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  FOR k IN SELECT jsonb_object_keys(p_values) LOOP
    SELECT id INTO v_field_id
    FROM public.lead_custom_fields
    WHERE organization_id = p_org AND lower(btrim(field_name)) = lower(btrim(k))
    LIMIT 1;

    IF v_field_id IS NULL THEN
      INSERT INTO public.lead_custom_fields (organization_id, field_name, field_type)
      VALUES (p_org, btrim(k), 'text')
      RETURNING id INTO v_field_id;
      criados := array_append(criados, btrim(k));
    END IF;

    INSERT INTO public.lead_custom_field_values (lead_id, field_id, value, updated_at)
    VALUES (p_lead_id, v_field_id, p_values->>k, now())
    ON CONFLICT (lead_id, field_id) DO UPDATE
      SET value = EXCLUDED.value, updated_at = now();
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'created_fields', to_jsonb(criados));
END;
$function$;
REVOKE ALL ON FUNCTION public.api_set_custom_fields_creating(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_set_custom_fields_creating(uuid,uuid,jsonb) TO authenticated, service_role;  -- prod: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}

CREATE OR REPLACE FUNCTION public.carteira_erp_source(p_order_id uuid, p_org_id uuid, p_tiny_order_id text, p_external_source text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.notas_fiscais n
      WHERE n.order_id = p_order_id AND n.organization_id = p_org_id
    ) THEN 'nfe'
    WHEN COALESCE(p_external_source, '') = 'omie' THEN 'omie'
    WHEN p_tiny_order_id IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM public.tinyerp_order_mappings m
        WHERE m.upsell_order_id = p_order_id AND m.organization_id = p_org_id
      )
      OR COALESCE(p_external_source, '') = 'tiny' THEN 'tiny'
    ELSE NULL
  END;
$function$;
REVOKE ALL ON FUNCTION public.carteira_erp_source(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.carteira_erp_source(uuid,uuid,text,text) TO anon, authenticated, service_role;  -- prod: {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}

CREATE OR REPLACE FUNCTION public.check_auth_rate_limit(p_ip text, p_endpoint text, p_max integer, p_window interval)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ip    text := COALESCE(NULLIF(btrim(p_ip), ''), 'unknown');
  v_count integer;
BEGIN
  INSERT INTO public.auth_rate_limits AS arl (ip, endpoint, window_start, request_count)
  VALUES (v_ip, p_endpoint, now(), 1)
  ON CONFLICT (ip, endpoint) DO UPDATE
    SET
      request_count = CASE
        WHEN arl.window_start < now() - p_window THEN 1
        ELSE arl.request_count + 1
      END,
      window_start = CASE
        WHEN arl.window_start < now() - p_window THEN now()
        ELSE arl.window_start
      END
  RETURNING arl.request_count INTO v_count;

  RETURN v_count <= p_max;
END;
$function$;
REVOKE ALL ON FUNCTION public.check_auth_rate_limit(text,text,integer,interval) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_auth_rate_limit(text,text,integer,interval) TO anon, authenticated, service_role;  -- prod: {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}

CREATE OR REPLACE FUNCTION public.claim_campaign_dispatch_batch(p_campanha_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50)
 RETURNS TABLE(claimed_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH batch AS (
    SELECT id
    FROM public.scheduled_campaign_messages
    WHERE status = 'scheduled'
      AND scheduled_at <= now()
      AND (p_campanha_id IS NULL OR campanha_id = p_campanha_id)
    ORDER BY scheduled_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.scheduled_campaign_messages scm
  SET status = 'processing'
  FROM batch
  WHERE scm.id = batch.id
  RETURNING scm.id AS claimed_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_campaign_dispatch_batch(uuid,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_campaign_dispatch_batch(uuid,integer) TO authenticated, service_role;  -- prod: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}

CREATE OR REPLACE FUNCTION public.claim_password_reset_token(p_token_hash text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_user_id uuid;
BEGIN
  UPDATE public.password_reset_tokens
  SET used_at = now()
  WHERE token_hash = p_token_hash
    AND used_at IS NULL
    AND expires_at > now()
  RETURNING user_id INTO v_user_id;

  RETURN v_user_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_password_reset_token(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_password_reset_token(text) TO anon, authenticated, service_role;  -- prod: {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}

CREATE OR REPLACE FUNCTION public.claim_pipe_dispatch_batch(p_pipe_type text DEFAULT NULL::text, p_limit integer DEFAULT 50)
 RETURNS TABLE(claimed_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  WITH batch AS (
    SELECT spm.id
    FROM public.scheduled_pipe_messages spm
    WHERE spm.status = 'scheduled'
      AND spm.scheduled_at <= now()
      AND (p_pipe_type IS NULL OR spm.pipe_type = p_pipe_type)
      AND (
        spm.pipeline_id IS NULL  -- legado sem funil resolvível: fluxo de hoje
        OR EXISTS (
          SELECT 1 FROM public.pipelines p
          WHERE p.id = spm.pipeline_id
            AND p.stage_dispatch_enabled
            AND p.stage_dispatch_enabled_at IS NOT NULL
            AND spm.created_at >= p.stage_dispatch_enabled_at  -- D11: nunca retroativo
        )
      )
    ORDER BY spm.scheduled_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.scheduled_pipe_messages spm
  SET status = 'processing', scheduled_at = now()
  FROM batch
  WHERE spm.id = batch.id
  RETURNING spm.id AS claimed_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_pipe_dispatch_batch(text,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_pipe_dispatch_batch(text,integer) TO authenticated, service_role;  -- prod: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}

CREATE OR REPLACE FUNCTION public.cleanup_copilot_message_queue()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_deleted_queue int;
  v_deleted_locks int;
BEGIN
  DELETE FROM copilot_message_queue
  WHERE status = 'done' AND processed_at < now() - interval '7 days';
  GET DIAGNOSTICS v_deleted_queue = ROW_COUNT;

  DELETE FROM copilot_processing_locks
  WHERE locked_at < now() - interval '24 hours';
  GET DIAGNOSTICS v_deleted_locks = ROW_COUNT;

  IF v_deleted_queue > 0 OR v_deleted_locks > 0 THEN
    RAISE LOG 'copilot_cleanup: queue=% locks=%', v_deleted_queue, v_deleted_locks;
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.cleanup_copilot_message_queue() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_copilot_message_queue() TO authenticated, service_role;  -- prod: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}

CREATE OR REPLACE FUNCTION public.convert_campaign_rule_to_workflow(p_rule_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rule record;
  v_step record;
  v_nodes jsonb := '[]'::jsonb;
  v_edges jsonb := '[]'::jsonb;
  v_node_id text;
  v_prev_id text := 'trigger';
  v_idx int := 0;
  v_workflow_id uuid;
  v_org_id uuid;
  v_delay_node_id text;
BEGIN
  SELECT cr.*, c.organization_id AS org_id
  INTO v_rule
  FROM public.campanha_dispatch_rules cr
  JOIN public.campanhas c ON c.id = cr.campanha_id
  WHERE cr.id = p_rule_id;

  IF v_rule IS NULL THEN
    RAISE EXCEPTION 'campanha_dispatch_rule % not found', p_rule_id;
  END IF;

  v_org_id := v_rule.org_id;

  -- Trigger
  v_nodes := v_nodes || jsonb_build_object(
    'id', 'trigger',
    'type', 'trigger',
    'data', jsonb_build_object(
      'trigger_type', CASE
        WHEN v_rule.trigger_type = 'lead_created' THEN 'lead_added_to_campaign'
        ELSE 'campaign_status_changed'
      END,
      'config', jsonb_build_object(
        'campanha_id', v_rule.campanha_id,
        'stage_id', v_rule.campanha_stage_id
      )
    )
  );

  -- Iterar steps em ordem
  FOR v_step IN
    SELECT * FROM public.campanha_dispatch_rule_steps
    WHERE rule_id = p_rule_id
    ORDER BY position ASC
  LOOP
    v_idx := v_idx + 1;
    v_node_id := 'step_' || v_idx;

    IF v_step.delay_minutes IS NOT NULL AND v_step.delay_minutes > 0 THEN
      v_delay_node_id := v_node_id || '_delay';
      v_nodes := v_nodes || jsonb_build_object(
        'id', v_delay_node_id,
        'type', 'delay',
        'data', jsonb_build_object('delayMinutes', v_step.delay_minutes)
      );
      v_edges := v_edges || jsonb_build_object('source', v_prev_id, 'target', v_delay_node_id);
      v_prev_id := v_delay_node_id;
    END IF;

    v_nodes := v_nodes || jsonb_build_object(
      'id', v_node_id,
      'type', 'action',
      'data', jsonb_build_object(
        'actionType', 'send_campaign_message',
        'templateId', v_step.template_id,
        'campanhaId', v_rule.campanha_id
      )
    );
    v_edges := v_edges || jsonb_build_object('source', v_prev_id, 'target', v_node_id);
    v_prev_id := v_node_id;
  END LOOP;

  INSERT INTO public.workflows (
    organization_id, name, trigger_type, trigger_config, definition,
    is_active, created_by, wrapper_for, wrapper_source_id
  ) VALUES (
    v_org_id,
    'Campaign Rule Wrapper: ' || v_rule.trigger_type,
    CASE WHEN v_rule.trigger_type = 'lead_created' THEN 'lead_added_to_campaign' ELSE 'campaign_status_changed' END,
    jsonb_build_object('campanha_id', v_rule.campanha_id, 'stage_id', v_rule.campanha_stage_id),
    jsonb_build_object('nodes', v_nodes, 'edges', v_edges),
    v_rule.is_active,
    NULL,
    'campaign_rule',
    p_rule_id
  )
  RETURNING id INTO v_workflow_id;

  RETURN v_workflow_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.convert_campaign_rule_to_workflow(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.convert_campaign_rule_to_workflow(uuid) TO authenticated, service_role;  -- prod: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}

CREATE OR REPLACE FUNCTION public.convert_pipe_rule_to_workflow(p_rule_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rule record;
  v_step record;
  v_nodes jsonb := '[]'::jsonb;
  v_edges jsonb := '[]'::jsonb;
  v_node_id text;
  v_prev_id text := 'trigger';
  v_idx int := 0;
  v_workflow_id uuid;
  v_trigger_node jsonb;
  v_action_node jsonb;
  v_delay_node_id text;
BEGIN
  SELECT * INTO v_rule FROM public.pipe_dispatch_rules WHERE id = p_rule_id;
  IF v_rule IS NULL THEN
    RAISE EXCEPTION 'pipe_dispatch_rule % not found', p_rule_id;
  END IF;

  -- Trigger node
  v_trigger_node := jsonb_build_object(
    'id', 'trigger',
    'type', 'trigger',
    'data', jsonb_build_object(
      'trigger_type', CASE
        WHEN v_rule.trigger_type = 'lead_added' THEN 'lead_created'
        ELSE 'stage_changed'
      END,
      'config', jsonb_build_object(
        'pipe_type', v_rule.pipe_type,
        'stage_id', v_rule.pipeline_stage_id
      )
    )
  );
  v_nodes := v_nodes || v_trigger_node;

  -- Iterar steps em ordem
  FOR v_step IN
    SELECT * FROM public.pipe_dispatch_rule_steps
    WHERE rule_id = p_rule_id
    ORDER BY position ASC
  LOOP
    v_idx := v_idx + 1;
    v_node_id := 'step_' || v_idx;

    -- Delay opcional ANTES do step
    IF v_step.delay_minutes IS NOT NULL AND v_step.delay_minutes > 0 THEN
      v_delay_node_id := v_node_id || '_delay';
      v_nodes := v_nodes || jsonb_build_object(
        'id', v_delay_node_id,
        'type', 'delay',
        'data', jsonb_build_object('delayMinutes', v_step.delay_minutes)
      );
      v_edges := v_edges || jsonb_build_object('source', v_prev_id, 'target', v_delay_node_id);
      v_prev_id := v_delay_node_id;
    END IF;

    -- Action node por tipo
    CASE v_step.action_type
      WHEN 'send_template' THEN
        v_action_node := jsonb_build_object(
          'id', v_node_id,
          'type', 'action',
          'data', jsonb_build_object(
            'actionType', 'send_whatsapp_template',
            'templateId', v_step.template_id,
            'whatsappInstanceId', v_rule.whatsapp_instance_id
          )
        );
      WHEN 'wait_response' THEN
        v_action_node := jsonb_build_object(
          'id', v_node_id,
          'type', 'wait_response',
          'data', jsonb_build_object('timeoutMinutes', COALESCE(v_step.wait_timeout_minutes, 1440))
        );
      WHEN 'change_stage' THEN
        v_action_node := jsonb_build_object(
          'id', v_node_id,
          'type', 'action',
          'data', jsonb_build_object('actionType', 'move_stage', 'targetStage', v_step.target_stage_id, 'pipeType', v_rule.pipe_type)
        );
      WHEN 'assign_sdr' THEN
        v_action_node := jsonb_build_object(
          'id', v_node_id,
          'type', 'assign_responsible',
          'data', jsonb_build_object('mode', COALESCE(v_step.sdr_assignment_mode, 'round_robin'), 'role', 'sdr', 'targetSdrId', v_step.target_sdr_id)
        );
      WHEN 'cancel_sequence' THEN
        -- Terminal: sem outgoing edges. break do loop.
        v_action_node := jsonb_build_object(
          'id', v_node_id,
          'type', 'action',
          'data', jsonb_build_object('actionType', 'noop_terminate')
        );
        v_nodes := v_nodes || v_action_node;
        v_edges := v_edges || jsonb_build_object('source', v_prev_id, 'target', v_node_id);
        EXIT;
      ELSE
        -- Ação desconhecida: skip
        CONTINUE;
    END CASE;

    v_nodes := v_nodes || v_action_node;
    v_edges := v_edges || jsonb_build_object('source', v_prev_id, 'target', v_node_id);

    -- wait_response: branch timeout opcional
    IF v_step.action_type = 'wait_response' AND v_step.timeout_action IS NOT NULL THEN
      DECLARE
        v_timeout_node_id text := v_node_id || '_timeout';
        v_timeout_node jsonb;
      BEGIN
        CASE v_step.timeout_action
          WHEN 'change_stage' THEN
            v_timeout_node := jsonb_build_object(
              'id', v_timeout_node_id,
              'type', 'action',
              'data', jsonb_build_object('actionType', 'move_stage', 'targetStage', v_step.timeout_target_stage_id, 'pipeType', v_rule.pipe_type)
            );
          WHEN 'send_template' THEN
            v_timeout_node := jsonb_build_object(
              'id', v_timeout_node_id,
              'type', 'action',
              'data', jsonb_build_object('actionType', 'send_whatsapp_template', 'templateId', v_step.template_id)
            );
          WHEN 'cancel_sequence' THEN
            v_timeout_node := jsonb_build_object(
              'id', v_timeout_node_id,
              'type', 'action',
              'data', jsonb_build_object('actionType', 'noop_terminate')
            );
          ELSE
            v_timeout_node := NULL;
        END CASE;

        IF v_timeout_node IS NOT NULL THEN
          v_nodes := v_nodes || v_timeout_node;
          v_edges := v_edges || jsonb_build_object('source', v_node_id, 'target', v_timeout_node_id, 'sourceHandle', 'timeout');
        END IF;
      END;
    END IF;

    v_prev_id := v_node_id;
  END LOOP;

  -- INSERT workflow wrapper
  INSERT INTO public.workflows (
    organization_id, name, trigger_type, trigger_config, definition,
    is_active, created_by, wrapper_for, wrapper_source_id
  ) VALUES (
    v_rule.organization_id,
    'Pipe Rule Wrapper: ' || v_rule.pipe_type || ' / ' || v_rule.trigger_type,
    CASE WHEN v_rule.trigger_type = 'lead_added' THEN 'lead_created' ELSE 'stage_changed' END,
    jsonb_build_object('pipe_type', v_rule.pipe_type, 'stage_id', v_rule.pipeline_stage_id),
    jsonb_build_object('nodes', v_nodes, 'edges', v_edges),
    v_rule.is_active,
    NULL,  -- created_by NULL pra wrappers (auto-gerados)
    'pipe_rule',
    p_rule_id
  )
  RETURNING id INTO v_workflow_id;

  RETURN v_workflow_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.convert_pipe_rule_to_workflow(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.convert_pipe_rule_to_workflow(uuid) TO authenticated, service_role;  -- prod: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}

CREATE OR REPLACE FUNCTION public.create_default_pipelines(p_org_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.pipelines (organization_id, name, slug, type, display_order, icon, color)
  SELECT p_org_id, d.name, d.slug, 'system', d.display_order, d.icon, d.color
    FROM (VALUES
      ('Qualificação', 'whatsapp',    0, 'zap',         '#22c55e'),
      ('Confirmação',  'confirmacao', 1, 'calendar',    '#3b82f6'),
      ('Propostas',    'propostas',   2, 'dollar-sign', '#f59e0b')
    ) AS d(name, slug, display_order, icon, color)
   WHERE EXISTS (
     SELECT 1 FROM public.pipeline_display_config c
      WHERE c.organization_id = p_org_id
        AND c.pipe_type = d.slug
   )
  ON CONFLICT (organization_id, slug) DO NOTHING;
END;
$function$;
REVOKE ALL ON FUNCTION public.create_default_pipelines(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_default_pipelines(uuid) TO authenticated, service_role;  -- prod: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}

CREATE OR REPLACE FUNCTION public.fn_dono_do_lead(p_lead_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    (SELECT tm.user_id FROM public.team_members tm JOIN public.leads l ON l.id = p_lead_id
      WHERE tm.id = l.sale_responsible_id     AND tm.is_active AND tm.user_id IS NOT NULL),
    (SELECT tm.user_id FROM public.team_members tm JOIN public.leads l ON l.id = p_lead_id
      WHERE tm.id = l.closer_id               AND tm.is_active AND tm.user_id IS NOT NULL),
    (SELECT tm.user_id FROM public.team_members tm JOIN public.leads l ON l.id = p_lead_id
      WHERE tm.id = l.pre_sale_responsible_id AND tm.is_active AND tm.user_id IS NOT NULL),
    (SELECT tm.user_id FROM public.team_members tm JOIN public.leads l ON l.id = p_lead_id
      WHERE tm.id = l.sdr_id                  AND tm.is_active AND tm.user_id IS NOT NULL),
    (SELECT tm.user_id FROM public.team_members tm JOIN public.leads l ON l.id = p_lead_id
      WHERE tm.id = l.responsible_id          AND tm.is_active AND tm.user_id IS NOT NULL)
  );
$function$;
REVOKE ALL ON FUNCTION public.fn_dono_do_lead(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_dono_do_lead(uuid) TO authenticated, service_role;  -- prod: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}

CREATE OR REPLACE FUNCTION public.fn_medicao_de_ruido(p_dias integer DEFAULT 7)
 RETURNS TABLE(dia date, organization_id uuid, user_id uuid, type text, avisos bigint, eventos bigint, lidos bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT date_trunc('day', timezone('America/Sao_Paulo', n.created_at))::date AS dia,
         n.organization_id,
         n.user_id,
         n.type,
         count(*)                                   AS avisos,
         -- Eventos absorvidos: um Aviso com contador 12 pesou muito mais na
         -- atenção da pessoa do que doze Avisos separados teriam pesado.
         sum(n.event_count)                         AS eventos,
         count(*) FILTER (WHERE n.read_at IS NOT NULL) AS lidos
    FROM public.notifications n
   WHERE n.created_at > now() - make_interval(days => p_dias)
   GROUP BY 1, 2, 3, 4;
$function$;
REVOKE ALL ON FUNCTION public.fn_medicao_de_ruido(integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_medicao_de_ruido(integer) TO authenticated, service_role;  -- prod: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}

CREATE OR REPLACE FUNCTION public.fn_pico_de_avisos_quentes(p_dias integer DEFAULT 7)
 RETURNS TABLE(organization_id uuid, user_id uuid, hora timestamp with time zone, quentes bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT n.organization_id,
         n.user_id,
         date_trunc('hour', n.created_at) AS hora,
         count(*) AS quentes
    FROM public.notifications n
   WHERE n.created_at > now() - make_interval(days => p_dias)
     AND n.type IN ('lead_message', 'transfer_to_human', 'lead_new', 'workflow_alert', 'cron_drift')
   GROUP BY 1, 2, 3
   ORDER BY 4 DESC;
$function$;
REVOKE ALL ON FUNCTION public.fn_pico_de_avisos_quentes(integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_pico_de_avisos_quentes(integer) TO authenticated, service_role;  -- prod: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}

CREATE OR REPLACE FUNCTION public.fn_preferencias_de_aviso(p_user_id uuid, p_organization_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    (SELECT to_jsonb(p) - 'id' - 'created_at' - 'updated_at'
       FROM public.notification_preferences p
      WHERE p.user_id = p_user_id
        AND p.organization_id = p_organization_id),
    jsonb_build_object(
      'organization_id',          p_organization_id,
      'user_id',                  p_user_id,
      'sound_enabled',            true,
      'volume',                   55,
      'quiet_hours_start',        NULL,
      'quiet_hours_end',          NULL,
      'mute_active_conversation', true,
      'push_enabled',             false,
      'overrides',                '{}'::jsonb
    )
  );
$function$;
REVOKE ALL ON FUNCTION public.fn_preferencias_de_aviso(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_preferencias_de_aviso(uuid,uuid) TO authenticated, service_role;  -- prod: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}

CREATE OR REPLACE FUNCTION public.get_lead_write_instance(p_lead_id uuid)
 RETURNS TABLE(instance_id uuid, instance_name text, owner_team_member_id uuid, responsible_user_id uuid, error_code text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id uuid;
  v_resp_tm_id uuid;
BEGIN
  SELECT l.organization_id, l.responsible_user_id
    INTO v_org_id, v_resp_tm_id
  FROM private.leads l
  WHERE l.id = p_lead_id;

  IF v_org_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::uuid, NULL::uuid, 'LEAD_NOT_FOUND'::text;
    RETURN;
  END IF;

  IF v_resp_tm_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::uuid, NULL::uuid, 'NO_RESPONSIBLE'::text;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT wi.id, wi.instance_name, wi.owner_team_member_id, v_resp_tm_id, NULL::text
  FROM public.whatsapp_instances wi
  WHERE wi.organization_id = v_org_id
    AND wi.owner_team_member_id = v_resp_tm_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::uuid, v_resp_tm_id, 'NO_INSTANCE'::text;
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_lead_write_instance(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_lead_write_instance(uuid) TO authenticated, service_role;  -- prod: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}

CREATE OR REPLACE FUNCTION public.has_concurrent_ai_action(p_lead_id uuid, p_action_type text, p_exclude_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM pending_ai_actions
    WHERE lead_id = p_lead_id
      AND action_type = p_action_type
      AND status = 'processing'
      AND id != p_exclude_id
  );
$function$;
REVOKE ALL ON FUNCTION public.has_concurrent_ai_action(uuid,text,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_concurrent_ai_action(uuid,text,uuid) TO PUBLIC, anon, authenticated, service_role;  -- prod: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}

CREATE OR REPLACE FUNCTION public.increment(table_name text, row_id uuid, column_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF table_name = 'campaign_templates' AND column_name = 'times_used' THEN
    UPDATE public.campaign_templates
    SET times_used = COALESCE(times_used, 0) + 1
    WHERE id = row_id;
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.increment(text,uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.increment(text,uuid,text) TO authenticated, service_role;  -- prod: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}

CREATE OR REPLACE FUNCTION public.increment_conversation_turn(p_conversation_id uuid, p_new_state text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE public.conversations
  SET turn_count = COALESCE(turn_count, 0) + 1,
      state = COALESCE(p_new_state, state),
      last_message_at = NOW(),
      updated_at = NOW()
  WHERE id = p_conversation_id;
$function$;
REVOKE ALL ON FUNCTION public.increment_conversation_turn(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.increment_conversation_turn(uuid,text) TO authenticated, service_role;  -- prod: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}

CREATE OR REPLACE FUNCTION public.process_overdue_subscriptions(p_grace_days integer DEFAULT 7)
 RETURNS TABLE(organization_id uuid, org_name text, days_overdue integer, new_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH overdue_orgs AS (
    SELECT
      o.id,
      o.name,
      COALESCE(
        (SELECT EXTRACT(DAY FROM NOW() - MIN(ph.created_at))::INTEGER
         FROM public.payment_history ph
         WHERE ph.organization_id = o.id
           AND ph.status = 'overdue'
        ),
        0
      ) AS overdue_days
    FROM public.organizations o
    WHERE o.subscription_status = 'overdue'
  )
  UPDATE public.organizations org
  SET
    subscription_status = 'suspended',
    updated_at = NOW()
  FROM overdue_orgs oo
  WHERE org.id = oo.id
    AND oo.overdue_days >= p_grace_days
  RETURNING org.id, oo.name, oo.overdue_days, 'suspended'::TEXT;
END;
$function$;
REVOKE ALL ON FUNCTION public.process_overdue_subscriptions(integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.process_overdue_subscriptions(integer) TO authenticated, service_role;  -- prod: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}

CREATE OR REPLACE FUNCTION public.purge_expired_rate_limits()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM rate_limits
  WHERE window_start + (window_seconds || ' seconds')::interval < now() - interval '1 hour';
END;
$function$;
REVOKE ALL ON FUNCTION public.purge_expired_rate_limits() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.purge_expired_rate_limits() TO authenticated, service_role;  -- prod: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}

CREATE OR REPLACE FUNCTION public.recalc_upsell_client_metrics(p_client_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org_id        uuid;
  v_org_default   int;
  v_order_count   int;   -- LINHAS de item (inalterado de propósito — ver cabeçalho)
  v_day_count     int;   -- PEDIDOS de verdade (dias UTC distintos com venda)
  v_total         numeric;
  v_avg           numeric;
  v_last          timestamptz;
  v_cycle         int;
  v_days_since    int;
  v_next          timestamptz;
  v_now           timestamptz := now();
BEGIN
  IF p_client_id IS NULL THEN
    RETURN;
  END IF;

  -- FOR UPDATE serializa recomputes concorrentes do MESMO cliente: sob READ
  -- COMMITTED, o 2º recompute espera o 1º commitar e então enxerga o order dele
  -- no agregado — evita lost-update (order_count/lifetime sobrescritos).
  SELECT organization_id INTO v_org_id
  FROM upsell_clients WHERE id = p_client_id
  FOR UPDATE;

  IF v_org_id IS NULL THEN
    RETURN; -- cliente inexistente (ex.: já deletado)
  END IF;

  -- default org de ciclo de recompra (fallback 30) — espelha orgDefaultCycleDays
  SELECT COALESCE(default_reorder_cycle_days, 30) INTO v_org_default
  FROM organizations WHERE id = v_org_id;
  v_org_default := COALESCE(v_org_default, 30);

  -- Agregados dos orders APPROVED (mesmo filtro do edge fn).
  -- count(*) = linhas; count(DISTINCT dia UTC) = pedidos de verdade.
  SELECT count(*),
         count(DISTINCT (sold_at AT TIME ZONE 'UTC')::date),
         COALESCE(sum(sale_value), 0),  -- metric-lint-allow: linha herdada verbatim da função viva; receita inalterada, ver cabeçalho (ADR-0017 SP-3)
         max(sold_at)
    INTO v_order_count, v_day_count, v_total, v_last
  FROM upsell_orders
  WHERE client_id = p_client_id
    AND approval_status = 'approved';

  -- avg_ticket: total / PEDIDOS, NULL se 0 (espelha `avgTicket || null` em JS)
  v_avg := CASE
             WHEN v_day_count > 0 AND v_total > 0 THEN v_total / v_day_count
             ELSE NULL
           END;

  -- reorder_cycle_days: < 2 PEDIDOS → default da org (não há gap pra medir);
  -- senão média dos gaps entre dias distintos, arredondada, mínimo 1.
  -- Espelha computeCycleDays(groupOrdersByDay(orders), orgDefault).
  IF v_day_count < 2 THEN
    v_cycle := v_org_default;
  ELSE
    SELECT round(avg(gap_days))::int
      INTO v_cycle
    FROM (
      SELECT (dia - lag(dia) OVER (ORDER BY dia))::numeric AS gap_days
      FROM (
        SELECT DISTINCT (sold_at AT TIME ZONE 'UTC')::date AS dia
        FROM upsell_orders
        WHERE client_id = p_client_id
          AND approval_status = 'approved'
      ) d
    ) g
    WHERE gap_days IS NOT NULL;
    -- COALESCE ANTES do GREATEST: GREATEST(1, NULL) = 1 em Postgres, então na
    -- ordem inversa o fallback pro default da org nunca disparava.
    v_cycle := GREATEST(1, COALESCE(v_cycle, v_org_default));
  END IF;

  -- days_since_last_order: 999 se nunca comprou (espelha edge fn); senão dias
  v_days_since := CASE
                    WHEN v_last IS NULL THEN 999
                    ELSE GREATEST(0, round(EXTRACT(EPOCH FROM (v_now - v_last)) / 86400.0)::int)
                  END;

  -- next_order_expected: último + ciclo (NULL se sem orders)
  v_next := CASE
              WHEN v_last IS NULL THEN NULL
              ELSE v_last + (v_cycle || ' days')::interval
            END;

  UPDATE upsell_clients SET
    order_count           = v_order_count,
    lifetime_value        = v_total,
    avg_ticket            = v_avg,
    last_order_at         = v_last,
    reorder_cycle_days    = v_cycle,
    days_since_last_order = v_days_since,
    next_order_expected   = v_next,
    updated_at            = v_now
  WHERE id = p_client_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.recalc_upsell_client_metrics(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recalc_upsell_client_metrics(uuid) TO authenticated, service_role;  -- prod: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}

CREATE OR REPLACE FUNCTION public.save_document_content(p_doc_id uuid, p_content text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$ UPDATE copilot_agent_documents SET content = p_content, updated_at = NOW() WHERE id = p_doc_id; $function$;
REVOKE ALL ON FUNCTION public.save_document_content(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_document_content(uuid,text) TO authenticated, service_role;  -- prod: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}

CREATE OR REPLACE FUNCTION public.try_provision_lock(p_user_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- pg_try_advisory_xact_lock returns true if lock acquired, false if already held.
  -- The lock is automatically released at the end of the current transaction.
  RETURN pg_try_advisory_xact_lock(hashtext(p_user_id));
END;
$function$;
REVOKE ALL ON FUNCTION public.try_provision_lock(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.try_provision_lock(text) TO PUBLIC, anon, authenticated, service_role;  -- prod: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
