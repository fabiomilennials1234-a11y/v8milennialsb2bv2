-- 20270905000030_meta_capi_sold_por_stage_role.sql
--
-- F0 do plano "Funil é Funil" (.specs/features/funis-unificacao/spec.md §4.1).
--
-- O sinal `sold` do Meta CAPI NUNCA disparou. O ramo `sold` de
-- `get_pending_meta_conversion_signals` filtrava:
--
--     JOIN public.pipelines p ON p.id = pe.pipeline_id
--     WHERE ... p.type = 'propostas' AND pe.stage_key = 'vendido'
--
-- `pipelines.type` só assume `system|custom` (medido em prod 2026-09-01:
-- SELECT DISTINCT type FROM pipelines → {system, custom}). `'propostas'` é o
-- SLUG do funil, não o type — o predicado é impossível e o EXISTS devolve
-- vazio para todo lead, desde o baseline.
--
-- Medido em prod 2026-09-01, read-only:
--   · 109 leads com meta_lead_id
--   · predicado velho  → 0 leads `sold` (sempre)
--   · predicado novo   → 7 leads `sold` (ganho em QUALQUER funil)
--
-- FIX (D4 do spec): venda é `stage_role = 'won'` via `metric_stage_role(org,
-- pipeline_id, stage_key)` — o mesmo ponto único que `fn_capture_sale_event`
-- (20270904000000) usa. Cobre funil de sistema E custom, e não depende do slug
-- `vendido` nem do funil se chamar `propostas`.
--
-- ASSINATURA E GRANTS: mesma assinatura/retorno → CREATE OR REPLACE (sem DROP,
-- grants sobrevivem). Ainda assim os grants são re-declarados explicitamente
-- abaixo, porque DROP+CREATE em migration futura resetaria para PUBLIC
-- (memória: drop-create-function-reseta-grants). Estado atual em prod
-- (has_function_privilege, 2026-09-01): anon=false, authenticated=false,
-- service_role=true, postgres=true — preservado ao final.
--
-- ENSAIO: janela de prod aprovada pelo CTO (D7); validação read-only do
-- predicado já feita (contagens acima). Rollback pareado:
-- rollback/20270905000030_meta_capi_sold_por_stage_role.sql

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
    -- `sold`: negócio ganho em QUALQUER funil — etapa com stage_role='won'
    -- resolvida por metric_stage_role (ponto único, cobre system e custom).
    -- Antes: p.type='propostas' (valor impossível) → ramo morto desde o baseline.
    SELECT l.id, l.organization_id, l.meta_lead_id, 'sold', 3, l.email, l.phone
    FROM public.leads l
    WHERE l.meta_lead_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.pipeline_entries pe
        WHERE pe.lead_id = l.id
          AND pe.organization_id = l.organization_id
          AND public.metric_stage_role(pe.organization_id, pe.pipeline_id, pe.stage_key) = 'won'
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

-- Grants explícitos (cron-only, service_role): idempotente com o estado de
-- prod; blindagem contra reset em DROP+CREATE futuro.
REVOKE ALL ON FUNCTION public.get_pending_meta_conversion_signals() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_meta_conversion_signals() TO service_role;

COMMENT ON FUNCTION public.get_pending_meta_conversion_signals() IS
  'Sinais Meta CAPI pendentes (cron, service_role only). sold = stage_role=''won'' via metric_stage_role em qualquer funil (fix 20270905000030 — antes filtrava p.type=''propostas'', valor impossível, e nunca disparou).';

-- Asserção pós-migration: o ramo morto não pode voltar.
DO $$
BEGIN
  IF pg_get_functiondef('public.get_pending_meta_conversion_signals()'::regprocedure) LIKE '%type = ''propostas''%' THEN
    RAISE EXCEPTION 'FAIL: get_pending_meta_conversion_signals ainda contém o predicado impossível p.type=''propostas''.';
  END IF;
  IF pg_get_functiondef('public.get_pending_meta_conversion_signals()'::regprocedure) NOT LIKE '%metric_stage_role%' THEN
    RAISE EXCEPTION 'FAIL: get_pending_meta_conversion_signals não usa metric_stage_role.';
  END IF;
  IF has_function_privilege('anon', 'public.get_pending_meta_conversion_signals()', 'execute')
     OR has_function_privilege('authenticated', 'public.get_pending_meta_conversion_signals()', 'execute') THEN
    RAISE EXCEPTION 'FAIL: grants vazaram para anon/authenticated em get_pending_meta_conversion_signals.';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.get_pending_meta_conversion_signals()', 'execute') THEN
    RAISE EXCEPTION 'FAIL: service_role perdeu EXECUTE em get_pending_meta_conversion_signals (cron para de rodar).';
  END IF;
END $$;
