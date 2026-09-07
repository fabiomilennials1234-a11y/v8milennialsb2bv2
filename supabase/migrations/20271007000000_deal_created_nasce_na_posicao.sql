-- GitHub #2002 / SCRUM-675
--
-- `deal_created` passa a representar o fato de domínio completo: um Negócio
-- com posição em funil e etapa. O INSERT isolado em `deals` deixa de emitir;
-- a primeira posição completa congela seu próprio id, Negócio, funil e etapa.

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
  v_pipeline_entry_id uuid;
  v_deal_id uuid;
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

  BEGIN
    v_pipeline_entry_id := NULLIF(p_context->>'pipeline_entry_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_pipeline_entry_id := NULL;
  END;

  BEGIN
    v_deal_id := NULLIF(p_context->>'deal_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_deal_id := NULL;
  END;

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
      pipeline_entry_id,
      deal_id,
      status,
      context,
      triggered_by_execution_id,
      chain_depth,
      trigger_dedup_key
    ) VALUES (
      v_workflow.id,
      p_organization_id,
      p_lead_id,
      v_pipeline_entry_id,
      v_deal_id,
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

COMMENT ON FUNCTION public.fire_workflow_trigger(uuid, text, uuid, jsonb, uuid) IS
  'Cria execuções com dedup e profundidade; persiste o sujeito declarado no contexto.';

CREATE OR REPLACE FUNCTION public.trigger_workflow_deal_created_from_position()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_deal public.deals%ROWTYPE;
  v_parent_execution_id uuid;
BEGIN
  IF NEW.deal_id IS NULL OR NEW.pipeline_id IS NULL OR NEW.stage_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.deal_id IS NOT NULL
     AND OLD.pipeline_id IS NOT NULL
     AND OLD.stage_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT d.* INTO v_deal
  FROM public.deals d
  WHERE d.id = NEW.deal_id
    AND d.organization_id = NEW.organization_id
    AND d.source_lead_id IS NOT DISTINCT FROM NEW.lead_id
    AND d.deleted_at IS NULL;

  IF v_deal.id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_deal.source IN (
    'entrada_materializada',
    'backfill',
    'backfill_funil_custom'
  ) THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_parent_execution_id := NULLIF(
      v_deal.metadata->>'workflow_execution_id',
      ''
    )::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_parent_execution_id := NULL;
  END;

  PERFORM public.fire_workflow_trigger(
    NEW.organization_id,
    'deal_created',
    v_deal.source_lead_id,
    jsonb_build_object(
      'trigger', 'deal_created',
      'lead_id', v_deal.source_lead_id,
      'deal_id', v_deal.id,
      'pipeline_entry_id', NEW.id,
      'pipeline_id', NEW.pipeline_id,
      'stage_id', NEW.stage_id,
      'deal_title', v_deal.title,
      'deal_value', COALESCE(v_deal.value, 0),
      'owner_id', v_deal.owner_id,
      'deal_source', v_deal.source,
      'created_by_workflow', (v_deal.source = 'workflow'),
      'negocio_id', v_deal.id,
      'negocio_titulo', v_deal.title,
      'negocio_valor', COALESCE(v_deal.value, 0)
    ),
    v_parent_execution_id
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trigger_workflow_deal_created_from_position() IS
  'Emite deal_created na primeira transição para uma posição completa do Negócio.';

DROP TRIGGER IF EXISTS trg_workflow_deal_created ON public.deals;

DROP TRIGGER IF EXISTS trg_workflow_deal_created_position_insert
  ON public.pipeline_entries;
CREATE TRIGGER trg_workflow_deal_created_position_insert
  AFTER INSERT ON public.pipeline_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_workflow_deal_created_from_position();

DROP TRIGGER IF EXISTS trg_workflow_deal_created_position_update
  ON public.pipeline_entries;
CREATE TRIGGER trg_workflow_deal_created_position_update
  AFTER UPDATE OF deal_id, pipeline_id, stage_id ON public.pipeline_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_workflow_deal_created_from_position();

REVOKE ALL ON FUNCTION public.trigger_workflow_deal_created_from_position()
  FROM PUBLIC, anon, authenticated;
