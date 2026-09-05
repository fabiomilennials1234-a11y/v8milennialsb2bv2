-- Rollback de 20271006000000_deal_created_nasce_na_posicao.sql

DROP TRIGGER IF EXISTS trg_workflow_deal_created_position_insert
  ON public.pipeline_entries;
DROP TRIGGER IF EXISTS trg_workflow_deal_created_position_update
  ON public.pipeline_entries;
DROP FUNCTION IF EXISTS public.trigger_workflow_deal_created_from_position();

DROP TRIGGER IF EXISTS trg_workflow_deal_created ON public.deals;
CREATE TRIGGER trg_workflow_deal_created
  AFTER INSERT ON public.deals
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_workflow_deal_created();

CREATE OR REPLACE FUNCTION public.fire_workflow_trigger(
  p_organization_id uuid,
  p_trigger_type text,
  p_lead_id uuid,
  p_context jsonb DEFAULT '{}'::jsonb,
  p_triggered_by_execution_id uuid DEFAULT NULL::uuid
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_workflow RECORD;
  v_count integer := 0;
  v_parent_depth smallint := 0;
  v_new_depth smallint;
  v_window integer;
  v_dedup_key text;
  v_inserted uuid;
  MAX_CHAIN_DEPTH CONSTANT smallint := 5;
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

  v_window := CASE WHEN p_trigger_type = 'stage_changed' THEN 300 ELSE 60 END;
  v_dedup_key := p_trigger_type
    || ':' || substr(md5(COALESCE(p_context, '{}'::jsonb)::text), 1, 16)
    || ':' || floor(extract(epoch FROM now()) / v_window)::text;

  FOR v_workflow IN
    SELECT id, trigger_config
    FROM public.workflows
    WHERE organization_id = p_organization_id
      AND trigger_type = p_trigger_type
      AND is_active = true
  LOOP
    IF NOT public.matches_workflow_trigger_config(
      p_trigger_type,
      v_workflow.trigger_config,
      p_context
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.workflow_executions (
      workflow_id,
      organization_id,
      lead_id,
      status,
      context,
      triggered_by_execution_id,
      chain_depth,
      trigger_dedup_key
    ) VALUES (
      v_workflow.id,
      p_organization_id,
      p_lead_id,
      'running',
      p_context || jsonb_build_object(
        'trigger_type', p_trigger_type,
        'trigger_config', v_workflow.trigger_config
      ),
      p_triggered_by_execution_id,
      v_new_depth,
      v_dedup_key
    )
    ON CONFLICT (workflow_id, lead_id, trigger_dedup_key) DO NOTHING
    RETURNING id INTO v_inserted;

    IF v_inserted IS NOT NULL THEN
      v_count := v_count + 1;
      v_inserted := NULL;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;
