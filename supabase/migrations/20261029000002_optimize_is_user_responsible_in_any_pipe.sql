-- P2: Optimize is_user_responsible_in_any_pipe() — query pipeline_entries directly.
--
-- Problem: Current implementation queries 3 legacy views (pipe_whatsapp,
-- pipe_confirmacao, pipe_propostas) which are views on pipeline_entries+pipelines.
-- Each view resolves metadata fields and does a JOIN. Called per-lead in leads RLS,
-- so 3 view queries × N leads = massive overhead.
--
-- Fix: Single query on pipeline_entries using assigned_to + metadata JSONB fields.
-- Uses idx_pipeline_entries_lead index for O(1) lead_id lookup.

CREATE OR REPLACE FUNCTION public.is_user_responsible_in_any_pipe(p_lead_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tm_ids uuid[];
BEGIN
  SELECT array_agg(id) INTO v_tm_ids
  FROM public.team_members
  WHERE user_id = auth.uid()
    AND is_active = true;

  IF v_tm_ids IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.pipeline_entries pe
    WHERE pe.lead_id = p_lead_id
      AND (
        pe.assigned_to = ANY(v_tm_ids)
        OR (pe.metadata->>'sdr_id')::uuid = ANY(v_tm_ids)
        OR (pe.metadata->>'responsible_id')::uuid = ANY(v_tm_ids)
        OR (pe.metadata->>'closer_id')::uuid = ANY(v_tm_ids)
        OR (pe.metadata->>'pre_sale_responsible_id')::uuid = ANY(v_tm_ids)
        OR (pe.metadata->>'sale_responsible_id')::uuid = ANY(v_tm_ids)
      )
  );
END;
$$;
