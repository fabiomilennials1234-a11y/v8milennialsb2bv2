-- ROLLBACK de 20270908006000_contexto_unico_dos_gatilhos_de_workflow.sql
--
-- Restaura, byte-fiel às versões anteriores:
--   · trigger_workflow_pipeline_stage_changed  → corpo da 20270827000010
--     + trigger do baseline (AFTER UPDATE OF stage_key, WHEN por valor);
--   · trigger_workflow_pipeline_custom_stage_change → corpo/trigger da
--     20270908001000 (AFTER UPDATE sem OF, WHEN por valor);
--   · trigger_workflow_pipeline_custom_entry → corpo da 20270908001000
--     (o trigger AFTER INSERT não foi tocado pela migration);
--   · master_workflow_config_scan → corpo da 20270822000000
--     (stage_keys chaveado só por pipeline_type);
--   · matches_workflow_trigger_config → corpo do baseline (conferido
--     byte-idêntico ao de prod em 2026-09-02).
--
-- Código TS (matcher/move-stage/pickers) é forward-compatible com o contexto
-- antigo — reverter só o banco não quebra o motor.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 1. Sistema ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trigger_workflow_pipeline_stage_changed() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
  v_url TEXT;
  v_secret TEXT;
  v_pipe_type TEXT;
  v_actor_user_id UUID;
  v_actor_member_id UUID;
BEGIN
  SELECT pip.slug INTO v_pipe_type
  FROM public.pipelines pip
  WHERE pip.id = NEW.pipeline_id AND pip.type = 'system';

  IF v_pipe_type IS NULL THEN RETURN NEW; END IF;

  SELECT value INTO v_url FROM public.cron_config WHERE key = 'campaign_rule_dispatch_url';
  SELECT value INTO v_secret FROM public.cron_config WHERE key = 'cron_secret';

  v_url := replace(v_url, 'campaign-rule-dispatch', 'process-workflow-executions');

  IF v_url IS NULL OR v_secret IS NULL THEN RETURN NEW; END IF;

  v_actor_user_id := auth.uid();
  IF v_actor_user_id IS NOT NULL THEN
    SELECT id INTO v_actor_member_id
    FROM public.team_members
    WHERE user_id = v_actor_user_id
      AND organization_id = NEW.organization_id
      AND is_active = true
    LIMIT 1;
  END IF;

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
        'to_stage', NEW.stage_key,
        'changed_by_user_id', v_actor_user_id,
        'changed_by_member_id', v_actor_member_id,
        'pipeline_entry_id', NEW.id,
        'deal_id', NEW.deal_id,
        'pipeline_id', NEW.pipeline_id
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

-- ── 2. Custom: mudança de etapa ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trigger_workflow_pipeline_custom_stage_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  IF NEW.lead_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pipelines p
                  WHERE p.id = NEW.pipeline_id AND p.type = 'custom') THEN
    RETURN NEW;
  END IF;

  PERFORM public.fire_workflow_trigger(
    NEW.organization_id, 'stage_changed', NEW.lead_id,
    jsonb_build_object('trigger', 'stage_changed',
                       'pipeline_id', NEW.pipeline_id::text,
                       'from_stage', OLD.stage_key,
                       'to_stage', NEW.stage_key,
                       'pipeline_entry_id', NEW.id,
                       'deal_id', NEW.deal_id));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_workflow_pipeline_custom_stage_change ON public.pipeline_entries;
CREATE TRIGGER trg_workflow_pipeline_custom_stage_change
  AFTER UPDATE ON public.pipeline_entries
  FOR EACH ROW
  WHEN (OLD.stage_key IS DISTINCT FROM NEW.stage_key)
  EXECUTE FUNCTION public.trigger_workflow_pipeline_custom_stage_change();

-- ── 3. Custom: entrada ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trigger_workflow_pipeline_custom_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  IF NEW.lead_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pipelines p
                  WHERE p.id = NEW.pipeline_id AND p.type = 'custom') THEN
    RETURN NEW;
  END IF;

  PERFORM public.fire_workflow_trigger(
    NEW.organization_id, 'lead_created', NEW.lead_id,
    jsonb_build_object('trigger', 'lead_created', 'pipeline_id', NEW.pipeline_id::text));

  PERFORM public.fire_workflow_trigger(
    NEW.organization_id, 'stage_changed', NEW.lead_id,
    jsonb_build_object('trigger', 'stage_changed',
                       'pipeline_id', NEW.pipeline_id::text,
                       'to_stage', NEW.stage_key));
  RETURN NEW;
END;
$$;

-- ── 4. Varredura do Master ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.master_workflow_config_scan()
RETURNS TABLE (
  workflow_id       uuid,
  workflow_name     text,
  organization_id   uuid,
  organization_name text,
  nodes             jsonb,
  stage_keys        jsonb
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $$
BEGIN
  IF NOT (SELECT public.is_master_user()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH etapas AS (
    SELECT ps.organization_id AS org,
           jsonb_object_agg(ps.pipeline_type, ps.chaves) AS por_pipe
    FROM (
      SELECT organization_id, pipeline_type, jsonb_agg(stage_key) AS chaves
      FROM public.pipeline_stages
      WHERE is_active
      GROUP BY organization_id, pipeline_type
    ) ps
    GROUP BY ps.organization_id
  )
  SELECT w.id,
         w.name::text,
         w.organization_id,
         o.name::text,
         COALESCE(w.definition -> 'nodes', '[]'::jsonb),
         COALESCE(e.por_pipe, '{}'::jsonb)
  FROM public.workflows w
  JOIN public.organizations o ON o.id = w.organization_id
  LEFT JOIN etapas e ON e.org = w.organization_id
  WHERE w.is_active
  ORDER BY o.name, w.name;
END $$;

REVOKE ALL ON FUNCTION public.master_workflow_config_scan() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.master_workflow_config_scan() TO authenticated;

COMMENT ON FUNCTION public.master_workflow_config_scan() IS
  'Matéria-prima da varredura de config de workflow: nós dos workflows ATIVOS + etapas '
  'válidas por funil. O veredito é do contrato em src/contracts/workflows/node-requirements.ts, '
  'a mesma função que o editor usa — SQL não replica as regras.';

-- ── 5. Matcher SQL ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.matches_workflow_trigger_config(p_trigger_type text, p_config jsonb, p_context jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'public', 'extensions'
    AS $$
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
