-- Rollback de 20271006000010_deal_created_filtra_funis.sql

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
    IF p_config->>'pipe_type' IS NOT NULL AND p_config->>'pipe_type' != '' THEN
      IF p_context->>'pipe_type' IS NOT NULL AND p_context->>'pipe_type' != '' THEN
        IF p_config->>'pipe_type' != p_context->>'pipe_type' THEN RETURN FALSE; END IF;
      ELSIF p_context->>'pipeline_id' IS NOT NULL AND p_context->>'pipeline_id' != '' THEN
        RETURN FALSE;
      END IF;
    END IF;

    IF p_config->>'pipeline_id' IS NOT NULL AND p_config->>'pipeline_id' != ''
       AND p_context->>'pipeline_id' IS NOT NULL
       AND p_config->>'pipeline_id' != p_context->>'pipeline_id'
    THEN RETURN FALSE; END IF;

    IF p_config->>'from_stage' IS NOT NULL AND p_config->>'from_stage' != ''
       AND p_context->>'from_stage' IS NOT NULL
       AND p_config->>'from_stage' != p_context->>'from_stage'
       AND p_config->>'from_stage' IS DISTINCT FROM p_context->>'from_stage_id'
    THEN RETURN FALSE; END IF;

    v_stages := p_config->'stages';
    v_to_stage := p_context->>'to_stage';
    v_stage_id := p_context->>'stage_id';
    IF v_stages IS NOT NULL AND jsonb_array_length(v_stages) > 0 AND v_to_stage IS NOT NULL THEN
      IF NOT (v_stages ? v_to_stage OR (v_stage_id IS NOT NULL AND v_stages ? v_stage_id))
      THEN RETURN FALSE; END IF;
    ELSIF p_config->>'to_stage' IS NOT NULL AND p_config->>'to_stage' != ''
          AND v_to_stage IS NOT NULL
          AND p_config->>'to_stage' != v_to_stage
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
