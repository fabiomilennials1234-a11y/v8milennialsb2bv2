-- Workflows: referências canônicas de funil em lead_created.
--
-- O editor grava pipelines.id para funis semeados e criados. O matcher anterior
-- ignorava filter_pipeline_id no caminho SQL e o trigger de entrada descartava
-- funis de sistema. Ambos passam a usar a mesma identidade.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.matches_workflow_trigger_config(
  p_trigger_type text,
  p_config jsonb,
  p_context jsonb
) RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_stages jsonb;
  v_to_stage text;
  v_stage_id text;
BEGIN
  CASE p_trigger_type

  WHEN 'stage_changed' THEN
    IF COALESCE(p_config->>'pipe_type', '') != ''
       AND p_config->>'pipe_type' IS DISTINCT FROM p_context->>'pipe_type'
    THEN RETURN FALSE; END IF;

    IF COALESCE(p_config->>'pipeline_id', '') != ''
       AND p_config->>'pipeline_id' IS DISTINCT FROM p_context->>'pipeline_id'
    THEN RETURN FALSE; END IF;

    IF COALESCE(p_config->>'from_stage', '') != ''
       AND p_config->>'from_stage' IS DISTINCT FROM p_context->>'from_stage'
       AND p_config->>'from_stage' IS DISTINCT FROM p_context->>'from_stage_id'
    THEN RETURN FALSE; END IF;

    v_stages := p_config->'stages';
    v_to_stage := p_context->>'to_stage';
    v_stage_id := p_context->>'stage_id';
    IF v_stages IS NOT NULL AND jsonb_typeof(v_stages) != 'array' THEN
      RETURN FALSE;
    ELSIF v_stages IS NOT NULL AND jsonb_array_length(v_stages) > 0 THEN
      IF NOT (
        (v_to_stage IS NOT NULL AND v_stages ? v_to_stage)
        OR (v_stage_id IS NOT NULL AND v_stages ? v_stage_id)
      ) THEN RETURN FALSE; END IF;
    ELSIF COALESCE(p_config->>'to_stage', '') != ''
          AND p_config->>'to_stage' IS DISTINCT FROM v_to_stage
          AND p_config->>'to_stage' IS DISTINCT FROM v_stage_id
    THEN RETURN FALSE; END IF;

    RETURN TRUE;

  WHEN 'field_changed' THEN
    IF p_config->>'field_name' IS NOT NULL AND p_config->>'field_name' != ''
       AND p_context->>'field_name' IS NOT NULL
       AND p_config->>'field_name' != p_context->>'field_name'
    THEN RETURN FALSE; END IF;
    RETURN TRUE;

  WHEN 'lead_created' THEN
    IF COALESCE(p_config->>'filter_origin', '') != '' THEN
      IF COALESCE(btrim(p_context->>'origin'), '') = ''
         OR lower(btrim(p_config->>'filter_origin')) != lower(btrim(p_context->>'origin'))
      THEN RETURN FALSE; END IF;
    END IF;

    -- Contrato canônico: UUID de pipelines para qualquer funil. Config canônica
    -- prevalece sobre o campo legado caso uma definição antiga carregue ambos.
    IF COALESCE(p_config->>'filter_pipeline_id', '') != '' THEN
      IF COALESCE(p_context->>'pipeline_id', '') = ''
         OR p_config->>'filter_pipeline_id' != p_context->>'pipeline_id'
      THEN RETURN FALSE; END IF;
    ELSIF COALESCE(p_config->>'filter_pipe', '') = ''
          AND COALESCE(p_context->>'pipeline_id', '') != '' THEN
      -- O INSERT do lead já dispara a automação genérica. A entrada no funil
      -- não deve criar uma segunda execução para o mesmo evento lógico.
      RETURN FALSE;
    END IF;

    -- Compatibilidade: pipe_whatsapp e whatsapp representam o mesmo seed.
    IF COALESCE(p_config->>'filter_pipeline_id', '') = ''
       AND COALESCE(p_config->>'filter_pipe', '') != '' THEN
      IF COALESCE(btrim(COALESCE(p_context->>'pipe', p_context->>'pipe_type')), '') = ''
         OR regexp_replace(lower(btrim(p_config->>'filter_pipe')), '^pipe_', '')
            != regexp_replace(
                 lower(btrim(COALESCE(p_context->>'pipe', p_context->>'pipe_type'))),
                 '^pipe_',
                 ''
               )
      THEN RETURN FALSE; END IF;
    END IF;

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

  WHEN 'deal_created' THEN
    IF p_config ? 'require_lead'
       AND jsonb_typeof(p_config->'require_lead') != 'boolean'
    THEN RETURN FALSE; END IF;

    IF COALESCE((p_config->>'require_lead')::boolean, TRUE)
       AND COALESCE(p_context->>'lead_id', '') = ''
    THEN RETURN FALSE; END IF;

    IF p_config ? 'source' AND jsonb_typeof(p_config->'source') != 'string'
    THEN RETURN FALSE; END IF;

    IF COALESCE(NULLIF(p_config->>'source', ''), 'any') != 'any'
       AND p_config->>'source' IS DISTINCT FROM p_context->>'deal_source'
    THEN RETURN FALSE; END IF;

    IF p_config ? 'pipeline_ids' THEN
      IF jsonb_typeof(p_config->'pipeline_ids') != 'array' THEN
        RETURN FALSE;
      END IF;

      IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_config->'pipeline_ids') AS item(value)
        WHERE jsonb_typeof(item.value) != 'string'
           OR btrim(item.value #>> '{}') = ''
      ) THEN
        RETURN FALSE;
      END IF;

      IF jsonb_array_length(p_config->'pipeline_ids') > 0 THEN
        IF COALESCE(p_context->>'pipeline_id', '') = ''
           OR NOT (p_config->'pipeline_ids' ? (p_context->>'pipeline_id'))
        THEN RETURN FALSE; END IF;
      END IF;
    END IF;

    IF p_config ? 'stage_ids' THEN
      IF jsonb_typeof(p_config->'stage_ids') != 'array' THEN
        RETURN FALSE;
      END IF;

      IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_config->'stage_ids') AS item(value)
        WHERE jsonb_typeof(item.value) != 'string'
           OR btrim(item.value #>> '{}') = ''
      ) THEN
        RETURN FALSE;
      END IF;

      IF jsonb_array_length(p_config->'stage_ids') > 0 THEN
        IF NOT (p_config ? 'pipeline_ids')
           OR jsonb_array_length(p_config->'pipeline_ids') = 0
           OR COALESCE(p_context->>'stage_id', '') = ''
           OR NOT (p_config->'stage_ids' ? (p_context->>'stage_id'))
        THEN RETURN FALSE; END IF;
      END IF;
    END IF;

    IF p_config ? 'filter_owner_id'
       AND jsonb_typeof(p_config->'filter_owner_id') != 'string'
    THEN RETURN FALSE; END IF;

    IF COALESCE(p_config->>'filter_owner_id', '') != ''
       AND p_config->>'filter_owner_id' IS DISTINCT FROM p_context->>'owner_id'
    THEN RETURN FALSE; END IF;

    BEGIN
      IF p_config ? 'min_value' AND p_config->>'min_value' IS NOT NULL
         AND COALESCE((p_context->>'deal_value')::numeric, 0)
             < (p_config->>'min_value')::numeric
      THEN RETURN FALSE; END IF;
    EXCEPTION
      WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RETURN FALSE;
    END;

    RETURN TRUE;

  ELSE
    RETURN TRUE;
  END CASE;
END;
$$;

COMMENT ON FUNCTION public.matches_workflow_trigger_config(text, jsonb, jsonb) IS
  'Filtra gatilhos no banco; lead_created usa pipeline_id para qualquer funil e deal_created combina funil e etapa congelados.';

CREATE OR REPLACE FUNCTION public.trigger_workflow_pipeline_custom_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  IF NEW.lead_id IS NULL THEN RETURN NEW; END IF;

  -- Nome da função preservado para o trigger existente. O comportamento agora
  -- é único: toda pipeline_entry nasce com pipeline_id, seja seed ou criada.
  PERFORM public.fire_workflow_trigger(
    NEW.organization_id, 'lead_created', NEW.lead_id,
    jsonb_build_object('trigger', 'lead_created',
                       'pipeline_id', NEW.pipeline_id::text,
                       'pipeline_entry_id', NEW.id,
                       'deal_id', NEW.deal_id,
                       'stage_id', NEW.stage_id,
                       'stage_key', NEW.stage_key));

  PERFORM public.fire_workflow_trigger(
    NEW.organization_id, 'stage_changed', NEW.lead_id,
    jsonb_build_object('trigger', 'stage_changed',
                       'pipeline_id', NEW.pipeline_id::text,
                       'pipeline_entry_id', NEW.id,
                       'deal_id', NEW.deal_id,
                       'stage_id', NEW.stage_id,
                       'stage_key', NEW.stage_key,
                       'to_stage', NEW.stage_key));
  RETURN NEW;
END;
$$;
