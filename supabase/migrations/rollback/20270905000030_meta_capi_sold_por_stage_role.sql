-- rollback/20270905000030_meta_capi_sold_por_stage_role.sql
--
-- Restaura a definição do baseline (20260101000000 ~linha 10140). ATENÇÃO:
-- isto restaura o COMPORTAMENTO QUEBRADO — o ramo `sold` volta a filtrar
-- p.type='propostas' (valor impossível) e nunca dispara. Só usar se a versão
-- nova causar problema operacional no cron.

CREATE OR REPLACE FUNCTION "public"."get_pending_meta_conversion_signals"() RETURNS TABLE("lead_id" "uuid", "organization_id" "uuid", "meta_lead_id" "text", "event_name" "text", "ad_account_id" "text", "dataset_override" "text", "email" "text", "phone" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  WITH cand AS (
    SELECT l.id AS lead_id, l.organization_id, l.meta_lead_id, 'initial'::text AS event_name, 0 AS rnk, l.email, l.phone
    FROM public.leads l WHERE l.meta_lead_id IS NOT NULL
    UNION ALL
    SELECT l.id, l.organization_id, l.meta_lead_id, 'qualified', 1, l.email, l.phone
    FROM public.leads l
    WHERE l.meta_lead_id IS NOT NULL
      AND COALESCE(l.qualification_tier::text, l.pre_qualification_tier::text) IN ('prata','ouro','diamante')
    UNION ALL
    SELECT l.id, l.organization_id, l.meta_lead_id, 'meeting', 2, l.email, l.phone
    FROM public.leads l WHERE l.meta_lead_id IS NOT NULL AND l.pipe_whatsapp = 'compareceu'
    UNION ALL
    SELECT l.id, l.organization_id, l.meta_lead_id, 'sold', 3, l.email, l.phone
    FROM public.leads l
    WHERE l.meta_lead_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.pipeline_entries pe JOIN public.pipelines p ON p.id = pe.pipeline_id
        WHERE pe.lead_id = l.id AND p.type = 'propostas' AND pe.stage_key = 'vendido'
      )
  )
  SELECT c.lead_id, c.organization_id, c.meta_lead_id, c.event_name, b.asset_id, b.dataset_id, c.email, c.phone
  FROM cand c
  JOIN public.meta_asset_bindings b
    ON b.organization_id = c.organization_id AND b.asset_type = 'ad_account' AND b.status = 'active'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.meta_signals_sent s WHERE s.lead_id = c.lead_id AND s.event_name = c.event_name
  )
  ORDER BY c.lead_id, c.rnk
  LIMIT 500;
$$;

REVOKE ALL ON FUNCTION public.get_pending_meta_conversion_signals() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_meta_conversion_signals() TO service_role;

COMMENT ON FUNCTION public.get_pending_meta_conversion_signals() IS NULL;
