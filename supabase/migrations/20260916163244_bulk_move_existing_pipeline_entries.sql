-- Bulk movement is about existing entries, never lead insertion. Use the same
-- invoker/RLS and history path as a single movement, in one atomic transaction.
ALTER TABLE public.pipeline_stage_events DROP CONSTRAINT IF EXISTS pipeline_stage_events_real_transition;
ALTER TABLE public.pipeline_stage_events ADD CONSTRAINT pipeline_stage_events_real_transition
  CHECK (from_stage_key IS DISTINCT FROM to_stage_key
    OR (from_pipeline_id IS NOT NULL AND from_pipeline_id IS DISTINCT FROM pipeline_id));

CREATE OR REPLACE FUNCTION public.bulk_move_pipeline_entries(
  p_entry_ids uuid[], p_source_pipeline_id uuid,
  p_target_pipeline_id uuid, p_target_stage_id uuid
) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_id uuid;
  v_pipeline uuid;
  v_stage text;
  v_target_key text;
  v_count integer := 0;
BEGIN
  IF p_entry_ids IS NULL OR cardinality(p_entry_ids) = 0 OR cardinality(p_entry_ids) > 1000
    OR array_position(p_entry_ids, NULL) IS NOT NULL OR p_source_pipeline_id IS NULL THEN
    RAISE EXCEPTION 'Selecione de 1 a 1000 negócios de origem.' USING ERRCODE = '22023';
  END IF;
  SELECT s.stage_key INTO v_target_key FROM public.pipeline_stages s
    JOIN public.pipelines p ON p.id = s.pipeline_id
    WHERE s.id = p_target_stage_id AND p.id = p_target_pipeline_id AND p.is_active AND s.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Funil ou etapa de destino indisponível.' USING ERRCODE = '22023';
  END IF;
  -- Stable lock ordering avoids deadlocks between overlapping bulk selections.
  FOR v_id IN SELECT DISTINCT x FROM unnest(p_entry_ids) AS ids(x) ORDER BY x LOOP
    SELECT pipeline_id, stage_key INTO v_pipeline, v_stage
      FROM public.pipeline_entries WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Negócio não encontrado ou sem acesso.' USING ERRCODE = '42501';
    END IF;
    IF v_pipeline = p_target_pipeline_id AND v_stage = v_target_key THEN
      v_count := v_count + 1;
      CONTINUE; -- Retry after success must not move/close again.
    END IF;
    IF v_pipeline IS DISTINCT FROM p_source_pipeline_id THEN
      RAISE EXCEPTION 'O negócio mudou de funil. Atualize a seleção.' USING ERRCODE = '40001';
    END IF;
    PERFORM public.mover_negocio(v_id, p_target_pipeline_id, p_target_stage_id::text);
    IF NOT EXISTS (SELECT 1 FROM public.pipeline_entries
      WHERE id = v_id AND pipeline_id = p_target_pipeline_id AND stage_key = v_target_key) THEN
      RAISE EXCEPTION 'Movimentação não autorizada.' USING ERRCODE = '42501';
    END IF;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.bulk_move_pipeline_entries(uuid[],uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulk_move_pipeline_entries(uuid[],uuid,uuid,uuid) TO authenticated, service_role;
