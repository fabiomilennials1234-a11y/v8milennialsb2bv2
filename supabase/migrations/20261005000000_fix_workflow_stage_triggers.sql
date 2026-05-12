-- Fix workflow stage_changed triggers after pipe_whatsapp/confirmacao/propostas
-- were converted from tables to VIEWs. The original AFTER UPDATE triggers on
-- those tables were lost. This creates a replacement trigger on pipeline_entries
-- (the actual table) and adds trigger_config validation to fire_workflow_trigger.

-- ============================================================
-- 1. New trigger on pipeline_entries for stage_changed
-- ============================================================

CREATE OR REPLACE FUNCTION public.trigger_workflow_pipeline_stage_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url TEXT;
  v_secret TEXT;
  v_pipe_type TEXT;
BEGIN
  SELECT pip.slug INTO v_pipe_type
  FROM public.pipelines pip
  WHERE pip.id = NEW.pipeline_id AND pip.type = 'system';

  IF v_pipe_type IS NULL THEN RETURN NEW; END IF;

  SELECT value INTO v_url FROM public.cron_config WHERE key = 'campaign_rule_dispatch_url';
  SELECT value INTO v_secret FROM public.cron_config WHERE key = 'cron_secret';

  v_url := replace(v_url, 'campaign-rule-dispatch', 'process-workflow-executions');

  IF v_url IS NULL OR v_secret IS NULL THEN RETURN NEW; END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := jsonb_build_object(
      'mode', 'fire_trigger',
      'organization_id', NEW.organization_id,
      'trigger_type', 'stage_changed',
      'lead_id', NEW.lead_id,
      'context', jsonb_build_object(
        'trigger', 'stage_changed',
        'pipe_type', v_pipe_type,
        'from_stage', OLD.stage_key,
        'to_stage', NEW.stage_key
      )
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_workflow_pipeline_stage_changed ON public.pipeline_entries;
CREATE TRIGGER trg_workflow_pipeline_stage_changed
  AFTER UPDATE OF stage_key ON public.pipeline_entries
  FOR EACH ROW
  WHEN (OLD.stage_key IS DISTINCT FROM NEW.stage_key)
  EXECUTE FUNCTION public.trigger_workflow_pipeline_stage_changed();

-- ============================================================
-- 2. Add trigger_config validation to fire_workflow_trigger
-- ============================================================

CREATE OR REPLACE FUNCTION public.matches_workflow_trigger_config(
  p_trigger_type TEXT,
  p_config JSONB,
  p_context JSONB
) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_stages JSONB;
  v_to_stage TEXT;
BEGIN
  CASE p_trigger_type

  WHEN 'stage_changed' THEN
    IF p_config->>'pipe_type' IS NOT NULL AND p_config->>'pipe_type' != ''
       AND p_context->>'pipe_type' IS NOT NULL
       AND p_config->>'pipe_type' != p_context->>'pipe_type'
    THEN RETURN FALSE; END IF;

    IF p_config->>'pipeline_id' IS NOT NULL AND p_config->>'pipeline_id' != ''
       AND p_context->>'pipeline_id' IS NOT NULL
       AND p_config->>'pipeline_id' != p_context->>'pipeline_id'
    THEN RETURN FALSE; END IF;

    IF p_config->>'from_stage' IS NOT NULL AND p_config->>'from_stage' != ''
       AND p_context->>'from_stage' IS NOT NULL
       AND p_config->>'from_stage' != p_context->>'from_stage'
    THEN RETURN FALSE; END IF;

    v_stages := p_config->'stages';
    v_to_stage := p_context->>'to_stage';
    IF v_stages IS NOT NULL AND jsonb_array_length(v_stages) > 0 AND v_to_stage IS NOT NULL THEN
      IF NOT v_stages ? v_to_stage THEN RETURN FALSE; END IF;
    ELSIF p_config->>'to_stage' IS NOT NULL AND p_config->>'to_stage' != ''
          AND v_to_stage IS NOT NULL
          AND p_config->>'to_stage' != v_to_stage
    THEN RETURN FALSE; END IF;

    RETURN TRUE;

  WHEN 'field_changed' THEN
    IF p_config->>'field_name' IS NOT NULL AND p_config->>'field_name' != ''
       AND p_context->>'field_name' IS NOT NULL
       AND p_config->>'field_name' != p_context->>'field_name'
    THEN RETURN FALSE; END IF;
    RETURN TRUE;

  WHEN 'lead_created' THEN
    IF p_config->>'filter_origin' IS NOT NULL AND p_config->>'filter_origin' != ''
       AND p_context->>'origin' IS NOT NULL
       AND p_config->>'filter_origin' != p_context->>'origin'
    THEN RETURN FALSE; END IF;

    IF p_config->>'filter_pipe' IS NOT NULL AND p_config->>'filter_pipe' != ''
       AND COALESCE(p_context->>'pipe', p_context->>'pipe_type') IS NOT NULL
       AND p_config->>'filter_pipe' != COALESCE(p_context->>'pipe', p_context->>'pipe_type')
    THEN RETURN FALSE; END IF;

    RETURN TRUE;

  WHEN 'tag_added' THEN
    IF p_config->>'tag_name' IS NOT NULL AND p_config->>'tag_name' != ''
       AND p_context->>'tag_name' IS NOT NULL
       AND lower(p_config->>'tag_name') != lower(p_context->>'tag_name')
    THEN RETURN FALSE; END IF;
    RETURN TRUE;

  WHEN 'score_reached' THEN
    IF COALESCE((p_config->>'min_score')::int, 0) > 0
       AND COALESCE((p_context->>'score')::int, 0) < (p_config->>'min_score')::int
    THEN RETURN FALSE; END IF;
    RETURN TRUE;

  ELSE
    RETURN TRUE;
  END CASE;
END;
$$;

-- Replace fire_workflow_trigger with config-aware version
CREATE OR REPLACE FUNCTION public.fire_workflow_trigger(
  p_organization_id UUID,
  p_trigger_type TEXT,
  p_lead_id UUID,
  p_context JSONB DEFAULT '{}'::jsonb,
  p_triggered_by_execution_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workflow RECORD;
  v_count INT := 0;
  v_parent_depth SMALLINT := 0;
  v_new_depth SMALLINT;
  MAX_CHAIN_DEPTH CONSTANT SMALLINT := 5;
BEGIN
  IF p_triggered_by_execution_id IS NOT NULL THEN
    SELECT chain_depth INTO v_parent_depth
    FROM public.workflow_executions
    WHERE id = p_triggered_by_execution_id;
    v_parent_depth := COALESCE(v_parent_depth, 0);
  END IF;

  v_new_depth := v_parent_depth + 1;

  IF v_new_depth > MAX_CHAIN_DEPTH THEN
    RAISE NOTICE 'fire_workflow_trigger blocked: chain_depth % > %',
      v_new_depth, MAX_CHAIN_DEPTH;
    RETURN 0;
  END IF;

  FOR v_workflow IN
    SELECT id, trigger_config
    FROM public.workflows
    WHERE organization_id = p_organization_id
      AND trigger_type = p_trigger_type
      AND is_active = true
  LOOP
    IF NOT matches_workflow_trigger_config(p_trigger_type, v_workflow.trigger_config, p_context) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.workflow_executions (
      workflow_id, organization_id, lead_id, status, context,
      triggered_by_execution_id, chain_depth
    ) VALUES (
      v_workflow.id, p_organization_id, p_lead_id, 'running',
      p_context || jsonb_build_object(
        'trigger_type', p_trigger_type,
        'trigger_config', v_workflow.trigger_config
      ),
      p_triggered_by_execution_id, v_new_depth
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;
