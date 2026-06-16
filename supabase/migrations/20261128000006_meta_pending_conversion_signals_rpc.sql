-- 20261128000006_meta_pending_conversion_signals_rpc.sql
-- Meta agency integration (ADR-0009) — Slice 5. APPLIED TO PROD 2026-06-15.
-- Read-only RPC: leads at a funnel milestone (qualified/meeting/sold) with a
-- meta_lead_id, whose Org has an Ad Account binding carrying a dataset_id, and
-- not yet in meta_signals_sent. Consumed by meta-conversion-dispatch.

CREATE OR REPLACE FUNCTION public.get_pending_meta_conversion_signals()
RETURNS TABLE (lead_id uuid, organization_id uuid, meta_lead_id text, event_name text, dataset_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH cand AS (
    SELECT l.id AS lead_id, l.organization_id, l.meta_lead_id, 'qualified'::text AS event_name
    FROM public.leads l
    WHERE l.meta_lead_id IS NOT NULL
      AND COALESCE(l.qualification_tier::text, l.pre_qualification_tier::text) IN ('prata','ouro','diamante')
    UNION ALL
    SELECT l.id, l.organization_id, l.meta_lead_id, 'meeting'
    FROM public.leads l
    WHERE l.meta_lead_id IS NOT NULL AND l.pipe_whatsapp = 'compareceu'
    UNION ALL
    SELECT l.id, l.organization_id, l.meta_lead_id, 'sold'
    FROM public.leads l
    WHERE l.meta_lead_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.pipeline_entries pe
        JOIN public.pipelines p ON p.id = pe.pipeline_id
        WHERE pe.lead_id = l.id AND p.type = 'propostas' AND pe.stage_key = 'vendido'
      )
  )
  SELECT c.lead_id, c.organization_id, c.meta_lead_id, c.event_name, b.dataset_id
  FROM cand c
  JOIN public.meta_asset_bindings b
    ON b.organization_id = c.organization_id
    AND b.asset_type = 'ad_account' AND b.status = 'active'
    AND b.dataset_id IS NOT NULL AND b.dataset_id <> ''
  WHERE NOT EXISTS (
    SELECT 1 FROM public.meta_signals_sent s
    WHERE s.lead_id = c.lead_id AND s.event_name = c.event_name
  )
  LIMIT 200;
$$;

REVOKE ALL ON FUNCTION public.get_pending_meta_conversion_signals() FROM anon, authenticated;
