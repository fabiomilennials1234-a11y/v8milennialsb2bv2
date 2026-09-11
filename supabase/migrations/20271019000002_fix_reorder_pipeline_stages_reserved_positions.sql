-- Reordenar só as etapas exibidas não pode reutilizar 0..N-1: etapas
-- desativadas continuam ocupando posições pela UNIQUE (pipeline_id, position).
-- Permuta as posições já pertencentes às etapas enviadas, em um statement.
CREATE OR REPLACE FUNCTION public.reorder_pipeline_stages(p_stage_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_count integer;
  v_pipelines integer;
  v_expected integer;
  v_updated integer;
BEGIN
  IF p_stage_ids IS NULL OR cardinality(p_stage_ids) = 0 THEN
    RETURN 0;
  END IF;

  IF EXISTS (SELECT 1 FROM unnest(p_stage_ids) t(id) GROUP BY id
             HAVING id IS NULL OR count(*) > 1) THEN
    RAISE EXCEPTION 'Etapas inválidas ou repetidas' USING ERRCODE = '22023';
  END IF;

  -- Ordem estável de locks serializa duas reordenações sobre as mesmas etapas.
  -- SECURITY INVOKER mantém SELECT/UPDATE sujeitos às permissões e à RLS.
  PERFORM ps.id FROM public.pipeline_stages ps
  WHERE ps.id = ANY(p_stage_ids) ORDER BY ps.id FOR UPDATE;

  SELECT count(*), count(DISTINCT pipeline_id) INTO v_count, v_pipelines
  FROM public.pipeline_stages WHERE id = ANY(p_stage_ids);
  IF v_count <> cardinality(p_stage_ids) OR v_pipelines <> 1 THEN
    RAISE EXCEPTION 'Etapas indisponíveis ou de funis diferentes'
      USING ERRCODE = '22023';
  END IF;

  WITH slots AS (
    SELECT position, row_number() OVER (ORDER BY position) AS ord
    FROM public.pipeline_stages WHERE id = ANY(p_stage_ids)
  ), changes AS (
    SELECT ps.id, slots.position
    FROM unnest(p_stage_ids) WITH ORDINALITY AS requested(id, ord)
    JOIN slots USING (ord)
    JOIN public.pipeline_stages ps ON ps.id = requested.id
    WHERE ps.position IS DISTINCT FROM slots.position
  ), updated AS (
    UPDATE public.pipeline_stages ps
    SET position = changes.position, updated_at = now()
    FROM changes WHERE ps.id = changes.id
    RETURNING ps.id
  )
  SELECT (SELECT count(*) FROM changes), (SELECT count(*) FROM updated)
    INTO v_expected, v_updated;

  IF v_updated <> v_expected THEN
    RAISE EXCEPTION 'Sem permissão para reordenar todas as etapas'
      USING ERRCODE = '42501';
  END IF;
  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.reorder_pipeline_stages(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_pipeline_stages(uuid[]) TO authenticated, service_role;
