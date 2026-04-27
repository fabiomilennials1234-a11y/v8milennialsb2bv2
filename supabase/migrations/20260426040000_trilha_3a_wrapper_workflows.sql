-- Trilha 3.A Fase A1 — Wrapper workflows pra unificação engines
--
-- Objetivo: workflow_engine vira fonte única. pipe_dispatch_rules +
-- campanha_dispatch_rules viram macros que geram workflows internos
-- (wrappers). UI atual continua igual; backend persiste em workflows com
-- flag wrapper_for + wrapper_source_id.
--
-- A1.1: cols wrapper_for + wrapper_source_id em workflows
-- A1.2: convert_pipe_rule_to_workflow(rule_id) → workflow_id
-- A1.3: convert_campaign_rule_to_workflow(rule_id) → workflow_id

-- ─────────────────────────────────────────────────────────────────────────────
-- A1.1: schema delta
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.workflows
  ADD COLUMN IF NOT EXISTS wrapper_for text
    CHECK (wrapper_for IS NULL OR wrapper_for IN ('pipe_rule', 'campaign_rule'));

ALTER TABLE public.workflows
  ADD COLUMN IF NOT EXISTS wrapper_source_id uuid;

-- Index pra hooks usePipeDispatchRules + useCampanhaDispatchRules buscarem
-- workflows wrappers eficientemente.
CREATE INDEX IF NOT EXISTS idx_workflows_wrapper
  ON public.workflows (wrapper_for, wrapper_source_id)
  WHERE wrapper_for IS NOT NULL;

COMMENT ON COLUMN public.workflows.wrapper_for IS
  'Trilha 3.A: marca workflow como wrapper auto-gerado de pipe_rule ou campaign_rule. NULL = workflow user-created via builder visual.';
COMMENT ON COLUMN public.workflows.wrapper_source_id IS
  'Trilha 3.A: FK virtual pra pipe_dispatch_rules.id ou campanha_dispatch_rules.id (depende de wrapper_for).';

-- ─────────────────────────────────────────────────────────────────────────────
-- A1.2: convert_pipe_rule_to_workflow
-- ─────────────────────────────────────────────────────────────────────────────
-- Converte pipe_dispatch_rule + steps em workflow.definition JSON
-- (nodes + edges) equivalente.
--
-- Mapping (audit T3A-A1):
--   trigger lead_added            → trigger node trigger_type=lead_created
--   trigger lead_moved_to_stage   → trigger node trigger_type=stage_changed
--   step send_template            → action send_whatsapp_template
--   step wait_response            → wait_response node + branches
--   step change_stage             → action move_stage
--   step assign_sdr               → assign_responsible node role=sdr
--   step cancel_sequence          → terminal (sem outgoing edges)

CREATE OR REPLACE FUNCTION public.convert_pipe_rule_to_workflow(p_rule_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.convert_pipe_rule_to_workflow(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.convert_pipe_rule_to_workflow(uuid) TO service_role;

COMMENT ON FUNCTION public.convert_pipe_rule_to_workflow(uuid) IS
  'Trilha 3.A A1.2: converte pipe_dispatch_rule em wrapper workflow equivalente. Retorna workflow_id criado.';

-- ─────────────────────────────────────────────────────────────────────────────
-- A1.3: convert_campaign_rule_to_workflow
-- ─────────────────────────────────────────────────────────────────────────────
-- Campaign rules são mais simples: apenas send_template em sequência com
-- delay_minutes entre steps.

CREATE OR REPLACE FUNCTION public.convert_campaign_rule_to_workflow(p_rule_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.convert_campaign_rule_to_workflow(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.convert_campaign_rule_to_workflow(uuid) TO service_role;

COMMENT ON FUNCTION public.convert_campaign_rule_to_workflow(uuid) IS
  'Trilha 3.A A1.3: converte campanha_dispatch_rule em wrapper workflow equivalente. Retorna workflow_id criado.';
