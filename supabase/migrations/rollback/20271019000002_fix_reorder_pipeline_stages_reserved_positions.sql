-- Restaura a defini??o anterior da RPC; n?o altera etapas.
CREATE OR REPLACE FUNCTION public.reorder_pipeline_stages(p_stage_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF p_stage_ids IS NULL OR array_length(p_stage_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  WITH ord AS (
    SELECT t.id, t.ord - 1 AS new_pos
    FROM unnest(p_stage_ids) WITH ORDINALITY AS t(id, ord)
  )
  UPDATE public.pipeline_stages ps
  SET position   = ord.new_pos,
      updated_at = now()
  FROM ord
  WHERE ps.id = ord.id
    AND ps.position IS DISTINCT FROM ord.new_pos;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.reorder_pipeline_stages(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_pipeline_stages(uuid[]) TO authenticated, service_role;
