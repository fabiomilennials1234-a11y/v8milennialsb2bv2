-- 20261128000008_meta_pending_signals_auto_dataset.sql
-- Meta agency integration (ADR-0009) — Slice 5 refactor. APPLIED TO PROD 2026-06-15.
-- Drops the manual dataset_id requirement: signal fires for any org with an
-- ACTIVE ad_account binding. The dispatcher auto-resolves the dataset from the
-- ad account (/{act}/adspixels); dataset_override only disambiguates when the
-- account has multiple datasets.

DROP FUNCTION IF EXISTS public.get_pending_meta_conversion_signals();

CREATE FUNCTION public.get_pending_meta_conversion_signals()
RETURNS TABLE (lead_id uuid, organization_id uuid, meta_lead_id text, event_name text, ad_account_id text, dataset_override text)
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
  SELECT c.lead_id, c.organization_id, c.meta_lead_id, c.event_name, b.asset_id AS ad_account_id, b.dataset_id AS dataset_override
  FROM cand c
  JOIN public.meta_asset_bindings b
    ON b.organization_id = c.organization_id AND b.asset_type = 'ad_account' AND b.status = 'active'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.meta_signals_sent s WHERE s.lead_id = c.lead_id AND s.event_name = c.event_name
  )
  LIMIT 200;
$$;

REVOKE ALL ON FUNCTION public.get_pending_meta_conversion_signals() FROM anon, authenticated;
