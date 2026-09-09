-- 20270908003000_rpcs_fundidas_por_pipeline_id.sql — SCRUM-626 (W3 · Funil é Funil)
--
-- Funde os pares system/custom das RPCs de kanban, contagem, público de
-- disparo, deleção e bulk num motor único por pipeline_id (spec F3, D1/D4).
-- Os nomes antigos viram WRAPPERS FINOS com assinatura e shape idênticos aos
-- de prod (snapshot pg_get_functiondef 2026-09-02) até a W6 demolir.
--
-- Mapa velha → nova:
--   get_pipeline_page(slug,…)                → ELA MESMA, + p_pipeline_id uuid
--                                              (id OU slug de QUALQUER funil;
--                                              shape de retorno inalterado)
--   get_pipeline_stage_counts(slug,…)        ┐
--   get_custom_pipeline_stage_counts(id,…)   ┴→ get_pipeline_stage_counts_by_id
--   get_stage_lead_ids(slug,stage)           ┐
--   get_filtered_lead_ids(slug,…)            ├→ get_pipeline_lead_ids
--   get_custom_filtered_lead_ids(id,…)       ┘
--   system_pipeline_delete_impact(org,slug)  ┐
--   custom_pipeline_delete_impact(id)        ┴→ pipeline_delete_impact(id)
--   delete_system_pipeline(org,slug)         ┐
--   delete_custom_pipeline(id)               ┴→ delete_pipeline(id)
--   bulk_add_to_custom_pipe(leads,id,stage)  ┐
--   bulk_move_stage(leads,slug,key)          ┴→ bulk_add_to_pipeline(leads,id,stage)
--
-- Fatos medidos em prod 2026-09-02 que sustentam as decisões deste arquivo:
--   • slug é único por org (0 duplicatas) → resolução por (org, slug) sem
--     predicado de type é determinística. Os predicados type='system' morrem
--     (2 dos 6 metric-lint-allows da checklist da unificação caem aqui).
--   • 105/105 pipeline_display_config órfãs são 'upsell' — os 3 slugs reais
--     SEMPRE têm linha em pipelines. O ramo legado sem id nos wrappers de
--     sistema só o upsell alcança.
--   • 37 pipeline_stages de sistema com pipeline_id NULL, todas de orgs cujo
--     funil já não existe (0 com funil vivo) → o delete unificado apaga etapas
--     por pipeline_id E, no ramo system, também por (org, pipeline_type).
--   • 1.091 entries custom já carregam metadata.pre/sale_responsible_id (o
--     INSTEAD OF do espelho escreve lá) → o motor de público adota o predicado
--     RICO (metadata + colunas do lead) para os dois mundos. Divergência
--     deliberada e na direção da paridade: o wrapper custom passa a honrar o
--     responsável da entry, como o board de sistema sempre fez.
--   • 85 entries com closed_at NULL paradas em etapa won/lost → o motor de
--     bulk combina as duas guardas históricas (closed_at IS NULL + etapa não
--     won/lost). bulk_move_stage deixa de mover essas 85 — mover PARA FORA de
--     won estorna venda de forma irreversível (ver cabeçalho de
--     bulk_move_stage no baseline); proteger é o comportamento correto.
--   • 0 pipelines inativos (system ou custom) → o motor de bulk exigir
--     is_active não muda nenhum comportamento observável hoje.
--
-- Grants (DROP+CREATE reseta ACL — regra da casa):
--   • Todos os wrappers são CREATE OR REPLACE com assinatura idêntica → ACL
--     de prod preservada intacta, função a função.
--   • get_pipeline_page ganha parâmetro novo → DROP + CREATE + grants
--     explícitos espelhando prod: authenticated + service_role, sem anon/PUBLIC.
--   • Funções novas: grants explícitos declarados em cada seção; nenhuma fica
--     com o EXECUTE default de PUBLIC.
--
-- Sem BEGIN/COMMIT de topo: o CLI embrulha em transação e o ensaio
-- (scripts/ensaio-scrum626.sh) concatena este arquivo numa transação maior.
-- Rollback pareado: supabase/migrations/rollback/20270908003000_*.sql
-- (restaura as 12 definições do snapshot de prod e derruba as 6 novas).

-- ────────────────────────────────────────────────────────────────────────────
-- §1 · get_pipeline_page — id OU slug de qualquer funil, shape inalterado
-- ────────────────────────────────────────────────────────────────────────────
-- Parâmetro novo NO FIM (p_pipeline_id) → assinatura muda → DROP + CREATE.
-- p_pipeline_slug/p_stage_id/p_org_id ganham DEFAULT NULL porque no Postgres
-- todo parâmetro após um default precisa de default; o corpo devolve vazio se
-- faltar org ou alvo (mesma semântica do IF v_pipeline_id IS NULL de antes).

DROP FUNCTION IF EXISTS public.get_pipeline_page(text, text, uuid, integer, timestamptz, text, uuid, uuid[], text[], integer, integer, integer, integer, text, text, timestamptz, timestamptz, timestamptz, timestamptz, text[], timestamptz, text[], text[], boolean, text[], text[], integer, integer);

CREATE FUNCTION public.get_pipeline_page(
  p_pipeline_slug text DEFAULT NULL,
  p_stage_id text DEFAULT NULL,
  p_org_id uuid DEFAULT NULL,
  p_page_size integer DEFAULT 20,
  p_cursor timestamptz DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_responsible_id uuid DEFAULT NULL,
  p_tag_ids uuid[] DEFAULT NULL,
  p_origins text[] DEFAULT NULL,
  p_rating_min integer DEFAULT NULL,
  p_rating_max integer DEFAULT NULL,
  p_calor_min integer DEFAULT NULL,
  p_calor_max integer DEFAULT NULL,
  p_urgency text DEFAULT NULL,
  p_product_type text DEFAULT NULL,
  p_meeting_after timestamptz DEFAULT NULL,
  p_meeting_before timestamptz DEFAULT NULL,
  p_period_after timestamptz DEFAULT NULL,
  p_period_before timestamptz DEFAULT NULL,
  p_closed_status_keys text[] DEFAULT NULL,
  p_updated_before timestamptz DEFAULT NULL,
  p_overdue_exclude_status_keys text[] DEFAULT NULL,
  p_status_keys text[] DEFAULT NULL,
  p_scheduled boolean DEFAULT NULL,
  p_qualification_tier text[] DEFAULT NULL,
  p_pre_qualification_tier text[] DEFAULT NULL,
  p_stalled_min_days integer DEFAULT NULL,
  p_stalled_max_days integer DEFAULT NULL,
  p_pipeline_id uuid DEFAULT NULL
)
 RETURNS TABLE(id uuid, pipeline_id uuid, lead_id uuid, stage_key text, assigned_to uuid, notes text, metadata jsonb, entered_at timestamptz, stage_changed_at timestamptz, created_at timestamptz, updated_at timestamptz, lead jsonb)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE v_pipeline_id UUID;
BEGIN
  IF p_org_id IS NULL OR (p_pipeline_id IS NULL AND p_pipeline_slug IS NULL) THEN
    RETURN;
  END IF;
  -- SCRUM-626: id é canônico; slug vira alias de QUALQUER funil da org (o
  -- predicado type='system' morreu — slug é único por org, medido 2026-09-02).
  SELECT p.id INTO v_pipeline_id
    FROM public.pipelines p
   WHERE p.organization_id = p_org_id
     AND ((p_pipeline_id IS NOT NULL AND p.id = p_pipeline_id)
       OR (p_pipeline_id IS NULL AND p.slug = p_pipeline_slug));
  IF v_pipeline_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT pe.id, pe.pipeline_id, pe.lead_id, pe.stage_key, pe.assigned_to, pe.notes, pe.metadata,
    pe.entered_at, pe.stage_changed_at, pe.created_at, pe.updated_at,
    jsonb_build_object(
      'id', l.id, 'name', l.name, 'company', l.company, 'email', l.email, 'phone', l.phone,
      'rating', l.rating, 'origin', l.origin, 'segment', l.segment, 'faturamento', l.faturamento,
      'urgency', l.urgency, 'notes', l.notes, 'compromisso_date', l.compromisso_date,
      'ai_disabled', l.ai_disabled, 'avatar_url', l.avatar_url,
      'pre_qualification_tier', l.pre_qualification_tier, 'qualification_tier', l.qualification_tier,
      'sdr_id', l.sdr_id, 'closer_id', l.closer_id, 'responsible_id', l.responsible_id,
      'pre_sale_responsible_id', l.pre_sale_responsible_id, 'sale_responsible_id', l.sale_responsible_id,
      'responsible', CASE WHEN tm_resp.id IS NOT NULL THEN jsonb_build_object('id', tm_resp.id, 'name', tm_resp.name, 'avatar_url', tm_resp.avatar_url) ELSE NULL END,
      'sdr', CASE WHEN tm_sdr.id IS NOT NULL THEN jsonb_build_object('id', tm_sdr.id, 'name', tm_sdr.name, 'avatar_url', tm_sdr.avatar_url) ELSE NULL END,
      'closer', CASE WHEN tm_closer.id IS NOT NULL THEN jsonb_build_object('id', tm_closer.id, 'name', tm_closer.name, 'avatar_url', tm_closer.avatar_url) ELSE NULL END,
      'pre_sale_responsible', CASE WHEN tm_pre.id IS NOT NULL THEN jsonb_build_object('id', tm_pre.id, 'name', tm_pre.name, 'avatar_url', tm_pre.avatar_url) ELSE NULL END,
      'sale_responsible', CASE WHEN tm_sale.id IS NOT NULL THEN jsonb_build_object('id', tm_sale.id, 'name', tm_sale.name, 'avatar_url', tm_sale.avatar_url) ELSE NULL END,
      'lead_tags', COALESCE((SELECT jsonb_agg(jsonb_build_object('tag', jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color))) FROM public.lead_tags lt JOIN public.tags t ON t.id = lt.tag_id WHERE lt.lead_id = l.id), '[]'::jsonb)
    ) AS lead
  FROM public.pipeline_entries pe
  JOIN public.leads l ON l.id = pe.lead_id
  LEFT JOIN public.team_members tm_resp ON tm_resp.id = l.responsible_id
  LEFT JOIN public.team_members tm_sdr ON tm_sdr.id = l.sdr_id
  LEFT JOIN public.team_members tm_closer ON tm_closer.id = l.closer_id
  LEFT JOIN public.team_members tm_pre ON tm_pre.id = l.pre_sale_responsible_id
  LEFT JOIN public.team_members tm_sale ON tm_sale.id = l.sale_responsible_id
  WHERE pe.pipeline_id = v_pipeline_id AND pe.stage_key = p_stage_id AND pe.organization_id = p_org_id
    AND pe.lead_id IS NOT NULL AND (p_cursor IS NULL OR pe.created_at < p_cursor)
    AND (p_search IS NULL OR p_search = '' OR (l.name ILIKE '%' || p_search || '%' OR l.phone ILIKE '%' || p_search || '%' OR l.company ILIKE '%' || p_search || '%'))
    AND (p_responsible_id IS NULL OR ((pe.metadata->>'pre_sale_responsible_id')::UUID = p_responsible_id OR (pe.metadata->>'sale_responsible_id')::UUID = p_responsible_id OR l.pre_sale_responsible_id = p_responsible_id OR l.sale_responsible_id = p_responsible_id))
    AND (p_tag_ids IS NULL OR array_length(p_tag_ids, 1) IS NULL OR NOT EXISTS (SELECT unnest(p_tag_ids) EXCEPT SELECT lt2.tag_id FROM public.lead_tags lt2 WHERE lt2.lead_id = l.id))
    AND (p_qualification_tier IS NULL OR array_length(p_qualification_tier, 1) IS NULL OR l.qualification_tier::text = ANY(p_qualification_tier))
    AND (p_pre_qualification_tier IS NULL OR array_length(p_pre_qualification_tier, 1) IS NULL OR l.pre_qualification_tier::text = ANY(p_pre_qualification_tier))
    AND (p_origins IS NULL OR array_length(p_origins, 1) IS NULL OR l.origin::TEXT = ANY(p_origins))
    AND (p_rating_min IS NULL OR COALESCE(l.rating, 0) >= p_rating_min)
    AND (p_rating_max IS NULL OR COALESCE(l.rating, 0) <= p_rating_max)
    AND (p_calor_min IS NULL OR COALESCE(NULLIF(pe.metadata->>'calor', '')::INT, 5) >= p_calor_min)
    AND (p_calor_max IS NULL OR COALESCE(NULLIF(pe.metadata->>'calor', '')::INT, 5) <= p_calor_max)
    AND (p_urgency IS NULL OR l.urgency = p_urgency)
    AND (p_product_type IS NULL OR pe.metadata->>'product_type' = p_product_type)
    AND (p_meeting_after IS NULL OR NULLIF(pe.metadata->>'meeting_date', '')::TIMESTAMPTZ >= p_meeting_after)
    AND (p_meeting_before IS NULL OR NULLIF(pe.metadata->>'meeting_date', '')::TIMESTAMPTZ <= p_meeting_before)
    AND (p_period_after IS NULL OR (CASE WHEN p_closed_status_keys IS NOT NULL AND pe.stage_key = ANY(p_closed_status_keys) THEN COALESCE(NULLIF(pe.metadata->>'metrics_period_at', '')::TIMESTAMPTZ, pe.updated_at) ELSE pe.created_at END) >= p_period_after)
    AND (p_period_before IS NULL OR (CASE WHEN p_closed_status_keys IS NOT NULL AND pe.stage_key = ANY(p_closed_status_keys) THEN COALESCE(NULLIF(pe.metadata->>'metrics_period_at', '')::TIMESTAMPTZ, pe.updated_at) ELSE pe.created_at END) <= p_period_before)
    AND (p_updated_before IS NULL OR (pe.updated_at <= p_updated_before AND (p_overdue_exclude_status_keys IS NULL OR pe.stage_key <> ALL(p_overdue_exclude_status_keys)))) -- metric-lint-allow: allow PRESERVADO do baseline, não é novo — filtro de lista "sem toque desde" (coluna Vencidos), não âncora de métrica; a âncora de período desta query continua em metrics_period_at (linha acima)
    AND (p_status_keys IS NULL OR array_length(p_status_keys, 1) IS NULL OR pe.stage_key = ANY(p_status_keys))
    AND (NOT COALESCE(p_scheduled, FALSE) OR EXISTS (SELECT 1 FROM public.scheduled_user_messages sm WHERE sm.lead_id = l.id AND sm.organization_id = p_org_id AND sm.status = 'scheduled'))
    -- "Parado há": idade na etapa atual. min = piso (>= N dias completos);
    -- max = teto (ainda não completou N+1).
    AND (p_stalled_min_days IS NULL OR COALESCE(pe.stage_changed_at, pe.entered_at, pe.created_at) <= now() - make_interval(days => p_stalled_min_days))
    AND (p_stalled_max_days IS NULL OR COALESCE(pe.stage_changed_at, pe.entered_at, pe.created_at) > now() - make_interval(days => p_stalled_max_days + 1))
  ORDER BY pe.created_at DESC LIMIT p_page_size;
END;
$function$;

-- DROP+CREATE resetou a ACL para o default (EXECUTE de PUBLIC). Espelho exato
-- da ACL de prod (snapshot 2026-09-02): authenticated + service_role, sem anon.
REVOKE ALL ON FUNCTION public.get_pipeline_page FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_pipeline_page FROM anon;
GRANT EXECUTE ON FUNCTION public.get_pipeline_page TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pipeline_page TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- §2 · Contagens — motor único get_pipeline_stage_counts_by_id
-- ────────────────────────────────────────────────────────────────────────────
-- Devolve stage_id + stage_key + cnt para QUALQUER funil. Predicados idênticos
-- ao get_pipeline_stage_counts do baseline (a superfície completa de filtros —
-- o lado custom herda a superfície toda, que só conhecia p_search: paridade).
-- GROUP BY (stage_id, stage_key): entries fantasma (stage_id NULL, 40 medidas)
-- saem como linha própria com a key — os wrappers reagregam pela dimensão que
-- cada shape antigo expõe.

CREATE FUNCTION public.get_pipeline_stage_counts_by_id(
  p_pipeline_id uuid,
  p_org_id uuid,
  p_search text DEFAULT NULL,
  p_responsible_id uuid DEFAULT NULL,
  p_tag_ids uuid[] DEFAULT NULL,
  p_origins text[] DEFAULT NULL,
  p_rating_min integer DEFAULT NULL,
  p_rating_max integer DEFAULT NULL,
  p_calor_min integer DEFAULT NULL,
  p_calor_max integer DEFAULT NULL,
  p_urgency text DEFAULT NULL,
  p_product_type text DEFAULT NULL,
  p_meeting_after timestamptz DEFAULT NULL,
  p_meeting_before timestamptz DEFAULT NULL,
  p_period_after timestamptz DEFAULT NULL,
  p_period_before timestamptz DEFAULT NULL,
  p_closed_status_keys text[] DEFAULT NULL,
  p_updated_before timestamptz DEFAULT NULL,
  p_overdue_exclude_status_keys text[] DEFAULT NULL,
  p_status_keys text[] DEFAULT NULL,
  p_scheduled boolean DEFAULT NULL,
  p_qualification_tier text[] DEFAULT NULL,
  p_pre_qualification_tier text[] DEFAULT NULL,
  p_stalled_min_days integer DEFAULT NULL,
  p_stalled_max_days integer DEFAULT NULL
)
 RETURNS TABLE(stage_id uuid, stage_key text, cnt bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
BEGIN
  RETURN QUERY
  SELECT pe.stage_id, pe.stage_key, COUNT(*)::BIGINT AS cnt
  FROM public.pipeline_entries pe
  JOIN public.leads l ON l.id = pe.lead_id
  WHERE pe.pipeline_id = p_pipeline_id AND pe.organization_id = p_org_id AND pe.lead_id IS NOT NULL
    AND (p_search IS NULL OR p_search = '' OR (l.name ILIKE '%' || p_search || '%' OR l.phone ILIKE '%' || p_search || '%' OR l.company ILIKE '%' || p_search || '%'))
    AND (p_responsible_id IS NULL OR ((pe.metadata->>'pre_sale_responsible_id')::UUID = p_responsible_id OR (pe.metadata->>'sale_responsible_id')::UUID = p_responsible_id OR l.pre_sale_responsible_id = p_responsible_id OR l.sale_responsible_id = p_responsible_id))
    AND (p_tag_ids IS NULL OR array_length(p_tag_ids, 1) IS NULL OR NOT EXISTS (SELECT unnest(p_tag_ids) EXCEPT SELECT lt2.tag_id FROM public.lead_tags lt2 WHERE lt2.lead_id = l.id))
    AND (p_qualification_tier IS NULL OR array_length(p_qualification_tier, 1) IS NULL OR l.qualification_tier::text = ANY(p_qualification_tier))
    AND (p_pre_qualification_tier IS NULL OR array_length(p_pre_qualification_tier, 1) IS NULL OR l.pre_qualification_tier::text = ANY(p_pre_qualification_tier))
    AND (p_origins IS NULL OR array_length(p_origins, 1) IS NULL OR l.origin::TEXT = ANY(p_origins))
    AND (p_rating_min IS NULL OR COALESCE(l.rating, 0) >= p_rating_min)
    AND (p_rating_max IS NULL OR COALESCE(l.rating, 0) <= p_rating_max)
    AND (p_calor_min IS NULL OR COALESCE(NULLIF(pe.metadata->>'calor', '')::INT, 5) >= p_calor_min)
    AND (p_calor_max IS NULL OR COALESCE(NULLIF(pe.metadata->>'calor', '')::INT, 5) <= p_calor_max)
    AND (p_urgency IS NULL OR l.urgency = p_urgency)
    AND (p_product_type IS NULL OR pe.metadata->>'product_type' = p_product_type)
    AND (p_meeting_after IS NULL OR NULLIF(pe.metadata->>'meeting_date', '')::TIMESTAMPTZ >= p_meeting_after)
    AND (p_meeting_before IS NULL OR NULLIF(pe.metadata->>'meeting_date', '')::TIMESTAMPTZ <= p_meeting_before)
    AND (p_period_after IS NULL OR (CASE WHEN p_closed_status_keys IS NOT NULL AND pe.stage_key = ANY(p_closed_status_keys) THEN COALESCE(NULLIF(pe.metadata->>'metrics_period_at', '')::TIMESTAMPTZ, pe.updated_at) ELSE pe.created_at END) >= p_period_after)
    AND (p_period_before IS NULL OR (CASE WHEN p_closed_status_keys IS NOT NULL AND pe.stage_key = ANY(p_closed_status_keys) THEN COALESCE(NULLIF(pe.metadata->>'metrics_period_at', '')::TIMESTAMPTZ, pe.updated_at) ELSE pe.created_at END) <= p_period_before)
    AND (p_updated_before IS NULL OR (pe.updated_at <= p_updated_before AND (p_overdue_exclude_status_keys IS NULL OR pe.stage_key <> ALL(p_overdue_exclude_status_keys)))) -- metric-lint-allow: allow PRESERVADO do baseline, não é novo — filtro de lista "sem toque desde" (coluna Vencidos), não âncora de métrica
    AND (p_status_keys IS NULL OR array_length(p_status_keys, 1) IS NULL OR pe.stage_key = ANY(p_status_keys))
    AND (NOT COALESCE(p_scheduled, FALSE) OR EXISTS (SELECT 1 FROM public.scheduled_user_messages sm WHERE sm.lead_id = l.id AND sm.organization_id = p_org_id AND sm.status = 'scheduled'))
    AND (p_stalled_min_days IS NULL OR COALESCE(pe.stage_changed_at, pe.entered_at, pe.created_at) <= now() - make_interval(days => p_stalled_min_days))
    AND (p_stalled_max_days IS NULL OR COALESCE(pe.stage_changed_at, pe.entered_at, pe.created_at) > now() - make_interval(days => p_stalled_max_days + 1))
  GROUP BY pe.stage_id, pe.stage_key;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_pipeline_stage_counts_by_id FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_pipeline_stage_counts_by_id FROM anon;
GRANT EXECUTE ON FUNCTION public.get_pipeline_stage_counts_by_id TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pipeline_stage_counts_by_id TO service_role;

-- Wrapper legado (shape antigo: stage_key + cnt). CREATE OR REPLACE com a
-- MESMA assinatura → ACL de prod intacta. Reagrega por stage_key porque o
-- motor separa linhas fantasma (stage_id NULL) da linha da etapa real.
CREATE OR REPLACE FUNCTION public.get_pipeline_stage_counts(p_pipeline_slug text, p_org_id uuid, p_search text DEFAULT NULL::text, p_responsible_id uuid DEFAULT NULL::uuid, p_tag_ids uuid[] DEFAULT NULL::uuid[], p_origins text[] DEFAULT NULL::text[], p_rating_min integer DEFAULT NULL::integer, p_rating_max integer DEFAULT NULL::integer, p_calor_min integer DEFAULT NULL::integer, p_calor_max integer DEFAULT NULL::integer, p_urgency text DEFAULT NULL::text, p_product_type text DEFAULT NULL::text, p_meeting_after timestamp with time zone DEFAULT NULL::timestamp with time zone, p_meeting_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_period_after timestamp with time zone DEFAULT NULL::timestamp with time zone, p_period_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_closed_status_keys text[] DEFAULT NULL::text[], p_updated_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_overdue_exclude_status_keys text[] DEFAULT NULL::text[], p_status_keys text[] DEFAULT NULL::text[], p_scheduled boolean DEFAULT NULL::boolean, p_qualification_tier text[] DEFAULT NULL::text[], p_pre_qualification_tier text[] DEFAULT NULL::text[], p_stalled_min_days integer DEFAULT NULL::integer, p_stalled_max_days integer DEFAULT NULL::integer)
 RETURNS TABLE(stage_key text, cnt bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE v_pipeline_id UUID;
BEGIN
  -- SCRUM-626: wrapper fino. Slug resolve QUALQUER funil da org (slug é único
  -- por org; o predicado type='system' morreu — era 1 dos 6 lint-allows).
  SELECT p.id INTO v_pipeline_id
    FROM public.pipelines p
   WHERE p.slug = p_pipeline_slug AND p.organization_id = p_org_id;
  IF v_pipeline_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT c.stage_key, SUM(c.cnt)::BIGINT
    FROM public.get_pipeline_stage_counts_by_id(
      v_pipeline_id, p_org_id, p_search, p_responsible_id, p_tag_ids, p_origins,
      p_rating_min, p_rating_max, p_calor_min, p_calor_max, p_urgency,
      p_product_type, p_meeting_after, p_meeting_before, p_period_after,
      p_period_before, p_closed_status_keys, p_updated_before,
      p_overdue_exclude_status_keys, p_status_keys, p_scheduled,
      p_qualification_tier, p_pre_qualification_tier,
      p_stalled_min_days, p_stalled_max_days) c
   GROUP BY c.stage_key;
END;
$function$;

-- Wrapper legado (shape antigo: stage_id + cnt). Divergência deliberada e
-- documentada: o baseline custom só conhecia p_search; agora a busca passa
-- pelo motor com os demais filtros desativados (NULL) — mesmo recorte.
CREATE OR REPLACE FUNCTION public.get_custom_pipeline_stage_counts(p_pipeline_id uuid, p_org_id uuid, p_search text DEFAULT NULL::text)
 RETURNS TABLE(stage_id uuid, cnt bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
BEGIN
  -- SCRUM-626: wrapper fino sobre o motor único.
  RETURN QUERY
  SELECT c.stage_id, SUM(c.cnt)::BIGINT
    FROM public.get_pipeline_stage_counts_by_id(p_pipeline_id, p_org_id, p_search) c
   GROUP BY c.stage_id;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- §3 · Público de disparo — motor único get_pipeline_lead_ids
-- ────────────────────────────────────────────────────────────────────────────
-- Une get_stage_lead_ids + get_filtered_lead_ids + get_custom_filtered_lead_ids.
-- Aceita id OU slug (o slug preserva a semântica de UNIÃO multi-org do
-- baseline: o caller em N orgs via o funil de cada org — um wrapper que
-- resolvesse UM id quebraria isso, por isso o join resolve dentro do motor).
-- Predicado de responsável é o RICO (metadata da entry + colunas do lead):
-- para o mundo custom isso é divergência deliberada na direção da paridade —
-- 1.091 entries custom já carregam metadata de responsável (2026-09-02).
-- Autorização VERBATIM do baseline: orgs do chamador OU org pedida quando
-- master; RLS do chamador continua valendo (não é SECURITY DEFINER).

CREATE FUNCTION public.get_pipeline_lead_ids(
  p_pipeline_id uuid DEFAULT NULL,
  p_pipeline_slug text DEFAULT NULL,
  p_stage_id uuid DEFAULT NULL,
  p_stage_key text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_responsible_id uuid DEFAULT NULL,
  p_tag_ids uuid[] DEFAULT NULL,
  p_qualification_tier text[] DEFAULT NULL,
  p_pre_qualification_tier text[] DEFAULT NULL,
  p_origin text[] DEFAULT NULL,
  p_organization_id uuid DEFAULT NULL
)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT pe.lead_id
  FROM public.pipeline_entries pe
  JOIN public.pipelines p
    ON p.id = pe.pipeline_id
   AND (p_pipeline_id IS NULL OR p.id = p_pipeline_id)
   AND (p_pipeline_slug IS NULL OR p.slug = p_pipeline_slug)
  JOIN public.leads l
    ON l.id = pe.lead_id
   AND l.deleted_at IS NULL
  WHERE pe.lead_id IS NOT NULL
    -- Alvo obrigatório: sem id e sem slug não existe "público de tudo".
    AND (p_pipeline_id IS NOT NULL OR p_pipeline_slug IS NOT NULL)
    -- AUTORIZAÇÃO: orgs do chamador (helper) OU a org pedida quando master.
    AND (
      pe.organization_id IN (SELECT public.get_my_organization_ids())
      OR (p_organization_id IS NOT NULL
          AND public.is_master_user()
          AND pe.organization_id = p_organization_id)
    )
    -- ESCOPO (SCRUM-429): quem passou a org quer AQUELA org, não a união.
    AND (p_organization_id IS NULL OR pe.organization_id = p_organization_id)
    -- Recorte de etapa: uuid é canônico, key é o alias legado; NULL = funil todo.
    AND (p_stage_id IS NULL OR pe.stage_id = p_stage_id)
    AND (p_stage_key IS NULL OR pe.stage_key = p_stage_key)
    -- Search filter (mirrors get_pipeline_page: name / phone / company).
    AND (p_search IS NULL OR p_search = '' OR (
      l.name    ILIKE '%' || p_search || '%'
      OR l.phone   ILIKE '%' || p_search || '%'
      OR l.company ILIKE '%' || p_search || '%'
    ))
    -- Responsible filter (dual fields: entry metadata + lead columns).
    AND (p_responsible_id IS NULL OR (
      (pe.metadata->>'pre_sale_responsible_id')::UUID = p_responsible_id
      OR (pe.metadata->>'sale_responsible_id')::UUID = p_responsible_id
      OR l.pre_sale_responsible_id = p_responsible_id
      OR l.sale_responsible_id = p_responsible_id
    ))
    -- Tag filter (intersection: lead must have ALL specified tags).
    AND (p_tag_ids IS NULL OR array_length(p_tag_ids, 1) IS NULL OR NOT EXISTS (
      SELECT unnest(p_tag_ids)
      EXCEPT
      SELECT lt.tag_id FROM public.lead_tags lt WHERE lt.lead_id = l.id
    ))
    -- Qualification tier (sale-side) — text membership, NULL/empty = all.
    AND (p_qualification_tier IS NULL OR array_length(p_qualification_tier, 1) IS NULL
      OR l.qualification_tier::text = ANY(p_qualification_tier))
    -- Pre-qualification tier — text membership, NULL/empty = all.
    AND (p_pre_qualification_tier IS NULL OR array_length(p_pre_qualification_tier, 1) IS NULL
      OR l.pre_qualification_tier::text = ANY(p_pre_qualification_tier))
    -- Origin — text membership, NULL/empty = all.
    AND (p_origin IS NULL OR array_length(p_origin, 1) IS NULL
      OR l.origin::text = ANY(p_origin));
$function$;

-- Espelha a ACL da família de resolvers de público do baseline (anon tinha
-- EXECUTE via PUBLIC; aqui o PUBLIC sai e os papéis reais entram explícitos —
-- anon devolve conjunto vazio porque get_my_organization_ids() não resolve).
REVOKE ALL ON FUNCTION public.get_pipeline_lead_ids FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pipeline_lead_ids TO anon;
GRANT EXECUTE ON FUNCTION public.get_pipeline_lead_ids TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pipeline_lead_ids TO service_role;

-- Wrapper legado: UMA etapa de um funil resolvido por slug (união multi-org).
-- `WHERE p_stage_key IS NOT NULL` preserva o contrato do baseline: p_stage_key
-- NULL nunca teve escape para "funil inteiro" aqui (igualdade com NULL = 0
-- linhas) — sem a guarda, o motor devolveria o funil todo.
CREATE OR REPLACE FUNCTION public.get_stage_lead_ids(p_pipeline_type text, p_stage_key text, p_organization_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  -- SCRUM-626: wrapper fino; o predicado type='system' morreu (slug único por org).
  SELECT ids FROM public.get_pipeline_lead_ids(
    p_pipeline_slug   => p_pipeline_type,
    p_stage_key       => p_stage_key,
    p_organization_id => p_organization_id
  ) ids
  WHERE p_stage_key IS NOT NULL;
$function$;

-- Wrapper legado: funil por slug + superfície de filtros do Disparo.
CREATE OR REPLACE FUNCTION public.get_filtered_lead_ids(p_pipeline_type text, p_stage_key text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_responsible_id uuid DEFAULT NULL::uuid, p_tag_ids uuid[] DEFAULT NULL::uuid[], p_qualification_tier text[] DEFAULT NULL::text[], p_pre_qualification_tier text[] DEFAULT NULL::text[], p_origin text[] DEFAULT NULL::text[], p_organization_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  -- SCRUM-626: wrapper fino; o predicado type='system' morreu (slug único por org).
  SELECT public.get_pipeline_lead_ids(
    p_pipeline_slug          => p_pipeline_type,
    p_stage_key              => p_stage_key,
    p_search                 => p_search,
    p_responsible_id         => p_responsible_id,
    p_tag_ids                => p_tag_ids,
    p_qualification_tier     => p_qualification_tier,
    p_pre_qualification_tier => p_pre_qualification_tier,
    p_origin                 => p_origin,
    p_organization_id        => p_organization_id
  );
$function$;

-- Wrapper legado: funil custom por id. Divergência deliberada (paridade):
-- p_responsible_id agora casa também com o metadata da entry — o comentário
-- "no entry-level responsible metadata" da 20261123000001 ficou obsoleto na
-- inversão do silo (SCRUM-621), que passou a escrever o responsável lá.
CREATE OR REPLACE FUNCTION public.get_custom_filtered_lead_ids(p_pipeline_id uuid, p_stage_id uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text, p_responsible_id uuid DEFAULT NULL::uuid, p_tag_ids uuid[] DEFAULT NULL::uuid[], p_qualification_tier text[] DEFAULT NULL::text[], p_pre_qualification_tier text[] DEFAULT NULL::text[], p_origin text[] DEFAULT NULL::text[], p_organization_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  -- SCRUM-626: wrapper fino sobre o motor único.
  SELECT public.get_pipeline_lead_ids(
    p_pipeline_id            => p_pipeline_id,
    p_stage_id               => p_stage_id,
    p_search                 => p_search,
    p_responsible_id         => p_responsible_id,
    p_tag_ids                => p_tag_ids,
    p_qualification_tier     => p_qualification_tier,
    p_pre_qualification_tier => p_pre_qualification_tier,
    p_origin                 => p_origin,
    p_organization_id        => p_organization_id
  );
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- §4 · Deleção — par único pipeline_delete_impact / delete_pipeline
-- ────────────────────────────────────────────────────────────────────────────
-- Um funil, um id. O ramo system carrega a bagagem chaveada por (org, slug)
-- que o mundo antigo pendurava no pipe_type (dispatch/distribution/scheduled/
-- sla/copilot/display_config/espelho leads.pipe_whatsapp); o ramo custom
-- preserva a recusa de cards invasores e o shape do impact do baseline.
-- Os DOIS shapes de impact são preservados por ramo — o wrapper é passthrough.
--
-- Nota de lint (R3): a distinção de ramo usa `type <> 'custom'` — mesmo
-- domínio (type ∈ {system,custom}), semanticamente idêntico a `= 'system'`.
-- Não é filtro de métrica: é resolução da linha de REGISTRO do funil, como os
-- allows do baseline documentavam; escrito na forma que não exige allow novo.

CREATE FUNCTION public.pipeline_delete_impact(p_pipeline_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pipe public.pipelines%ROWTYPE;
BEGIN
  SELECT * INTO v_pipe FROM public.pipelines WHERE id = p_pipeline_id;

  IF v_pipe.id IS NULL THEN
    RAISE EXCEPTION 'funil não encontrado' USING ERRCODE = 'P0002';
  END IF;

  -- SECURITY DEFINER bypassa RLS: a autorização é reimplementada aqui.
  -- `current_setting('role')` é a convenção do repo para a chave de serviço.
  IF NOT (v_pipe.organization_id IN (SELECT public.get_my_organization_ids())
          OR public.is_master_user()
          OR current_setting('role', true) = 'service_role') THEN
    RAISE EXCEPTION 'sem permissão sobre este funil' USING ERRCODE = '42501';
  END IF;

  IF v_pipe.type <> 'custom' THEN
    -- Ramo SYSTEM: shape idêntico ao system_pipeline_delete_impact do baseline.
    -- cards/leads: as views pipe_* não filtram lead_id — contagem crua por
    -- pipeline_id reproduz os números (view = entries do funil do slug).
    RETURN jsonb_build_object(
      'pipe_type',   v_pipe.slug,
      'pipeline_id', v_pipe.id,
      'cards',
        (SELECT count(*) FROM public.pipeline_entries
          WHERE pipeline_id = v_pipe.id),
      'leads',
        (SELECT count(DISTINCT lead_id) FROM public.pipeline_entries
          WHERE pipeline_id = v_pipe.id),
      -- Por (org, pipeline_type), não por pipeline_id: preserva as etapas
      -- órfãs do backfill da FK (pipeline_id NULL) na contagem, como antes.
      'etapas',
        (SELECT count(*) FROM public.pipeline_stages
          WHERE organization_id = v_pipe.organization_id
            AND pipeline_type = v_pipe.slug),
      'eventos_etapa',
        (SELECT count(*) FROM public.pipeline_stage_events
          WHERE pipeline_id = v_pipe.id),
      'vendas_orfas',
        (SELECT count(*) FROM public.sale_events
          WHERE pipeline_id = v_pipe.id),
      -- Casa os DOIS jeitos de citar o funil (slug com/sem prefixo + uuid) —
      -- racional medido no baseline: 14 de 30 automações só têm filter_pipe.
      'automacoes',
        (SELECT count(*) FROM public.workflows w
          WHERE w.organization_id = v_pipe.organization_id
            AND w.is_active
            AND (w.trigger_config->>'filter_pipe' IN (v_pipe.slug, 'pipe_' || v_pipe.slug)
              OR strpos(w.definition::text, v_pipe.id::text) > 0
              OR strpos(w.trigger_config::text, v_pipe.id::text) > 0)),
      'regras_dispatch',
        (SELECT count(*) FROM public.pipe_dispatch_rules
          WHERE organization_id = v_pipe.organization_id AND pipe_type = v_pipe.slug),
      'regras_distribuicao',
        (SELECT count(*) FROM public.pipe_distribution_rules
          WHERE organization_id = v_pipe.organization_id AND pipe_type = v_pipe.slug),
      'mensagens_agendadas',
        (SELECT count(*) FROM public.scheduled_pipe_messages
          WHERE organization_id = v_pipe.organization_id
            AND pipe_type = v_pipe.slug
            AND status IN ('pending', 'waiting')),
      'agentes_copilot',
        (SELECT count(*) FROM public.copilot_agents
          WHERE organization_id = v_pipe.organization_id AND active_pipes ? v_pipe.slug)
    );
  END IF;

  -- Ramo CUSTOM: shape idêntico ao custom_pipeline_delete_impact do baseline
  -- (contagens direto na fonte — as views custom_* são espelho 1:1 pós-621).
  RETURN jsonb_build_object(
    'cards',
      (SELECT count(*) FROM public.pipeline_entries
        WHERE pipeline_id = v_pipe.id),
    'leads',
      (SELECT count(DISTINCT lead_id) FROM public.pipeline_entries
        WHERE pipeline_id = v_pipe.id),
    'etapas',
      (SELECT count(*) FROM public.pipeline_stages
        WHERE pipeline_id = v_pipe.id),
    'membros',
      (SELECT count(*) FROM public.custom_pipeline_members
        WHERE pipeline_id = v_pipe.id),
    'eventos_etapa',
      (SELECT count(*) FROM public.pipeline_stage_events
        WHERE pipeline_id = v_pipe.id),
    'vendas_orfas',
      (SELECT count(*) FROM public.sale_events
        WHERE pipeline_id = v_pipe.id),
    'negocios_orfaos',
      (SELECT count(DISTINCT deal_id) FROM public.pipeline_entries
        WHERE pipeline_id = v_pipe.id AND deal_id IS NOT NULL),
    -- Card de outro funil pousado numa etapa deste. > 0 impede o delete.
    'cards_invasores',
      (SELECT count(*) FROM public.pipeline_entries e
         JOIN public.pipeline_stages s ON s.id = e.stage_id
        WHERE s.pipeline_id = v_pipe.id
          AND e.pipeline_id <> v_pipe.id),
    'automacoes',
      (SELECT count(*) FROM public.workflows w
        WHERE w.organization_id = v_pipe.organization_id
          AND w.is_active
          AND (strpos(w.definition::text, v_pipe.id::text) > 0
            OR strpos(w.trigger_config::text, v_pipe.id::text) > 0)),
    'disparos_em_voo',
      (SELECT count(*) FROM public.blast_plans b
        WHERE b.organization_id = v_pipe.organization_id
          AND b.status IN ('active', 'paused')
          AND b.post_send_target->>'pipelineId' = v_pipe.id::text)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.pipeline_delete_impact FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pipeline_delete_impact FROM anon;
GRANT EXECUTE ON FUNCTION public.pipeline_delete_impact TO authenticated;
GRANT EXECUTE ON FUNCTION public.pipeline_delete_impact TO service_role;

CREATE FUNCTION public.delete_pipeline(p_pipeline_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pipe      public.pipelines%ROWTYPE;
  v_is_system boolean;
  v_impact    jsonb;
  v_wf        integer := 0;
  v_bp        integer := 0;
  v_cop       integer := 0;
  v_invasores integer := 0;
  v_exemplo   text;
BEGIN
  -- Lock direto na fonte; qualquer tipo de funil.
  SELECT * INTO v_pipe FROM public.pipelines WHERE id = p_pipeline_id FOR UPDATE;

  IF v_pipe.id IS NULL THEN
    RAISE EXCEPTION 'funil não encontrado' USING ERRCODE = 'P0002';
  END IF;
  v_is_system := v_pipe.type <> 'custom';

  IF NOT (v_pipe.organization_id IN (SELECT public.get_my_organization_ids())
          OR public.is_master_user()
          OR current_setting('role', true) = 'service_role') THEN
    RAISE EXCEPTION 'sem permissão sobre este funil' USING ERRCODE = '42501';
  END IF;

  -- Recusa de cards invasores: contrato do mundo custom, preservado por ramo.
  -- O caminho system do baseline nunca recusou (a FK stage_id é SET NULL e o
  -- card invasor sobrevive fantasma) — manter idêntico até a W6 decidir.
  IF NOT v_is_system THEN
    SELECT count(*), min(coalesce(p.name, '(sem nome)') || ' / ' || coalesce(l.name, e.lead_id::text))
      INTO v_invasores, v_exemplo
      FROM public.pipeline_entries e
      JOIN public.pipeline_stages s ON s.id = e.stage_id
      LEFT JOIN public.pipelines p ON p.id = e.pipeline_id
      LEFT JOIN public.leads l     ON l.id = e.lead_id
     WHERE s.pipeline_id = p_pipeline_id
       AND e.pipeline_id <> p_pipeline_id;

    IF v_invasores > 0 THEN
      RAISE EXCEPTION
        'card de outro funil parado numa etapa deste: % card(s), ex. "%". Mova-os para o funil de origem antes de excluir.',
        v_invasores, v_exemplo
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Medir ANTES de apagar — depois os números seriam todos zero.
  v_impact := public.pipeline_delete_impact(p_pipeline_id);

  -- (a) Automações que citam o funil: desativar é honesto (aparecem desligadas
  --     em vez de "ligadas e mortas"). No ramo system o slug também conta.
  UPDATE public.workflows w
     SET is_active = false,
         updated_at = now()
   WHERE w.organization_id = v_pipe.organization_id
     AND w.is_active
     AND (strpos(w.definition::text, v_pipe.id::text) > 0
       OR strpos(w.trigger_config::text, v_pipe.id::text) > 0
       OR (v_is_system
           AND w.trigger_config->>'filter_pipe' IN (v_pipe.slug, 'pipe_' || v_pipe.slug)));
  GET DIAGNOSTICS v_wf = ROW_COUNT;

  -- (b) Disparo em voo com destino neste funil (o release diário não revalida
  --     o destino). NULL = "mantém o lead onde está".
  UPDATE public.blast_plans
     SET post_send_target = NULL,
         updated_at = now()
   WHERE organization_id = v_pipe.organization_id
     AND status IN ('active', 'paused')
     AND post_send_target->>'pipelineId' = v_pipe.id::text;
  GET DIAGNOSTICS v_bp = ROW_COUNT;

  IF v_is_system THEN
    -- (c) Agente de IA que operava o funil (active_pipes é chaveado por slug;
    --     nenhum gatilho o limpa).
    UPDATE public.copilot_agents
       SET active_pipes  = active_pipes - v_pipe.slug,
           active_stages = COALESCE(active_stages, '{}'::jsonb) - v_pipe.slug,
           updated_at    = now()
     WHERE organization_id = v_pipe.organization_id
       AND active_pipes ? v_pipe.slug;
    GET DIAGNOSTICS v_cop = ROW_COUNT;

    -- (d) Regras e mensagens em voo, chaveadas por (org, pipe_type).
    --     Passos antes das regras: a FK filha não declara ON DELETE.
    DELETE FROM public.pipe_dispatch_rule_steps
     WHERE rule_id IN (SELECT id FROM public.pipe_dispatch_rules
                        WHERE organization_id = v_pipe.organization_id
                          AND pipe_type = v_pipe.slug);
    DELETE FROM public.pipe_dispatch_rules
     WHERE organization_id = v_pipe.organization_id AND pipe_type = v_pipe.slug;
    DELETE FROM public.pipe_distribution_rules
     WHERE organization_id = v_pipe.organization_id AND pipe_type = v_pipe.slug;
    DELETE FROM public.scheduled_pipe_messages
     WHERE organization_id = v_pipe.organization_id AND pipe_type = v_pipe.slug;
    DELETE FROM public.sla_configs
     WHERE organization_id = v_pipe.organization_id AND pipeline_type = v_pipe.slug;

    -- (e) O ESPELHO NO LEAD, À MÃO — e ANTES dos cards. O gatilho
    --     trg_sync_whatsapp_stage_to_lead existe, mas o baseline provou (1.248
    --     leads medidos) que depender de gatilho aqui é depender de código que
    --     pode não executar (trava de pg_trigger_depth no caminho via view).
    --     O DELETE direto na fonte roda o gatilho em depth 1, e esta linha
    --     continua como cinto de segurança idempotente.
    IF v_pipe.slug = 'whatsapp' THEN
      UPDATE public.leads
         SET pipe_whatsapp = NULL
       WHERE organization_id = v_pipe.organization_id
         AND pipe_whatsapp IS NOT NULL;
    END IF;

    -- (f) Itens de proposta: pipe_proposta_items.pipe_proposta_id NÃO tem FK.
    IF v_pipe.slug = 'propostas' THEN
      DELETE FROM public.pipe_proposta_items
       WHERE pipe_proposta_id IN (SELECT id FROM public.pipe_propostas
                                   WHERE organization_id = v_pipe.organization_id);
    END IF;
  END IF;

  -- (g) Os cards, direto na fonte (baseline system apagava via view pipe_*,
  --     que faz exatamente este DELETE por INSTEAD OF; custom já era direto).
  DELETE FROM public.pipeline_entries WHERE pipeline_id = v_pipe.id;

  -- (h) As etapas. Por pipeline_id E, no ramo system, também por
  --     (org, pipeline_type) — cobre as órfãs do backfill da FK, como antes.
  --     Dispara on_pipeline_stage_removed e trg_queue_followup_reclassify.
  DELETE FROM public.pipeline_stages
   WHERE pipeline_id = v_pipe.id
      OR (v_is_system
          AND organization_id = v_pipe.organization_id
          AND pipeline_type = v_pipe.slug);

  -- (i) A linha de registro em pipelines. CASCADE leva o que sobrou de
  --     pipeline_stage_events, custom_pipeline_members e custom_pipe_transitions.
  DELETE FROM public.pipelines WHERE id = v_pipe.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DELETE não afetou nenhuma linha' USING ERRCODE = 'P0001';
  END IF;

  -- (j) O registro de exibição (só existe no mundo system). É este delete que
  --     impede o funil de voltar via create_default_pipelines.
  IF v_is_system THEN
    DELETE FROM public.pipeline_display_config
     WHERE organization_id = v_pipe.organization_id AND pipe_type = v_pipe.slug;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'DELETE do registro não afetou nenhuma linha' USING ERRCODE = 'P0001';
    END IF;

    RETURN v_impact || jsonb_build_object(
      'automacoes_desativadas', v_wf,
      'disparos_neutralizados', v_bp,
      'agentes_ajustados',      v_cop
    );
  END IF;

  RETURN v_impact || jsonb_build_object(
    'automacoes_desativadas', v_wf,
    'disparos_neutralizados', v_bp
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_pipeline FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_pipeline FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_pipeline TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_pipeline TO service_role;

-- Wrapper legado: impact do mundo system por (org, pipe_type).
CREATE OR REPLACE FUNCTION public.system_pipeline_delete_impact(p_org_id uuid, p_pipe_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pipeline_id uuid;
BEGIN
  IF p_pipe_type NOT IN ('whatsapp', 'confirmacao', 'propostas', 'upsell') THEN
    RAISE EXCEPTION 'tipo de funil de sistema desconhecido: %', p_pipe_type
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT (p_org_id IN (SELECT public.get_my_organization_ids())
          OR public.is_master_user()
          OR current_setting('role', true) = 'service_role') THEN
    RAISE EXCEPTION 'sem permissão sobre esta organização' USING ERRCODE = '42501';
  END IF;

  -- SCRUM-626: wrapper fino. `type <> 'custom'` = resolução de REGISTRO, não
  -- métrica (racional dos allows do baseline), na forma que dispensa allow novo.
  SELECT id INTO v_pipeline_id
    FROM public.pipelines
   WHERE organization_id = p_org_id AND slug = p_pipe_type
     AND type <> 'custom';

  IF v_pipeline_id IS NOT NULL THEN
    RETURN public.pipeline_delete_impact(v_pipeline_id);
  END IF;

  -- RAMO LEGADO sem linha em pipelines — medido 2026-09-02: só 'upsell' chega
  -- aqui (105/105 órfãs); Carteira não tem tabela de cards. Reproduz o shape
  -- do baseline com v_pipeline_id NULL (subconsultas por id = 0).
  RETURN jsonb_build_object(
    'pipe_type',   p_pipe_type,
    'pipeline_id', NULL,
    'cards',       0,
    'leads',       0,
    'etapas',
      (SELECT count(*) FROM public.pipeline_stages
        WHERE organization_id = p_org_id AND pipeline_type = p_pipe_type),
    'eventos_etapa', 0,
    'vendas_orfas',  0,
    'automacoes',
      (SELECT count(*) FROM public.workflows w
        WHERE w.organization_id = p_org_id
          AND w.is_active
          AND w.trigger_config->>'filter_pipe' IN (p_pipe_type, 'pipe_' || p_pipe_type)),
    'regras_dispatch',
      (SELECT count(*) FROM public.pipe_dispatch_rules
        WHERE organization_id = p_org_id AND pipe_type = p_pipe_type),
    'regras_distribuicao',
      (SELECT count(*) FROM public.pipe_distribution_rules
        WHERE organization_id = p_org_id AND pipe_type = p_pipe_type),
    'mensagens_agendadas',
      (SELECT count(*) FROM public.scheduled_pipe_messages
        WHERE organization_id = p_org_id
          AND pipe_type = p_pipe_type
          AND status IN ('pending', 'waiting')),
    'agentes_copilot',
      (SELECT count(*) FROM public.copilot_agents
        WHERE organization_id = p_org_id AND active_pipes ? p_pipe_type)
  );
END;
$function$;

-- Wrapper legado: delete do mundo system por (org, pipe_type).
CREATE OR REPLACE FUNCTION public.delete_system_pipeline(p_org_id uuid, p_pipe_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pipeline_id uuid;
  v_impact      jsonb;
  v_wf          integer := 0;
  v_cop         integer := 0;
BEGIN
  IF p_pipe_type NOT IN ('whatsapp', 'confirmacao', 'propostas', 'upsell') THEN
    RAISE EXCEPTION 'tipo de funil de sistema desconhecido: %', p_pipe_type
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT (p_org_id IN (SELECT public.get_my_organization_ids())
          OR public.is_master_user()
          OR current_setting('role', true) = 'service_role') THEN
    RAISE EXCEPTION 'sem permissão sobre esta organização' USING ERRCODE = '42501';
  END IF;

  -- O registro é a fonte da verdade sobre "a org tem este funil". Sem linha,
  -- não há o que excluir — e recusar é melhor que devolver sucesso vazio.
  IF NOT EXISTS (
    SELECT 1 FROM public.pipeline_display_config
     WHERE organization_id = p_org_id AND pipe_type = p_pipe_type
  ) THEN
    RAISE EXCEPTION 'esta organização não tem o funil %', p_pipe_type
      USING ERRCODE = 'P0002';
  END IF;

  -- SCRUM-626: wrapper fino; resolução de REGISTRO (ver nota de lint no §4).
  SELECT id INTO v_pipeline_id
    FROM public.pipelines
   WHERE organization_id = p_org_id AND slug = p_pipe_type
     AND type <> 'custom'
     FOR UPDATE;

  IF v_pipeline_id IS NOT NULL THEN
    RETURN public.delete_pipeline(v_pipeline_id);
  END IF;

  -- RAMO LEGADO sem linha em pipelines (só 'upsell' alcança — ver impact).
  -- Reproduz o baseline com v_pipeline_id NULL: sem cards, sem blast_plans
  -- (o UPDATE era gateado em id NOT NULL), sem linha em pipelines.
  v_impact := public.system_pipeline_delete_impact(p_org_id, p_pipe_type);

  UPDATE public.workflows w
     SET is_active = false,
         updated_at = now()
   WHERE w.organization_id = p_org_id
     AND w.is_active
     AND w.trigger_config->>'filter_pipe' IN (p_pipe_type, 'pipe_' || p_pipe_type);
  GET DIAGNOSTICS v_wf = ROW_COUNT;

  UPDATE public.copilot_agents
     SET active_pipes  = active_pipes - p_pipe_type,
         active_stages = COALESCE(active_stages, '{}'::jsonb) - p_pipe_type,
         updated_at    = now()
   WHERE organization_id = p_org_id
     AND active_pipes ? p_pipe_type;
  GET DIAGNOSTICS v_cop = ROW_COUNT;

  DELETE FROM public.pipe_dispatch_rule_steps
   WHERE rule_id IN (SELECT id FROM public.pipe_dispatch_rules
                      WHERE organization_id = p_org_id AND pipe_type = p_pipe_type);
  DELETE FROM public.pipe_dispatch_rules
   WHERE organization_id = p_org_id AND pipe_type = p_pipe_type;
  DELETE FROM public.pipe_distribution_rules
   WHERE organization_id = p_org_id AND pipe_type = p_pipe_type;
  DELETE FROM public.scheduled_pipe_messages
   WHERE organization_id = p_org_id AND pipe_type = p_pipe_type;
  DELETE FROM public.sla_configs
   WHERE organization_id = p_org_id AND pipeline_type = p_pipe_type;

  DELETE FROM public.pipeline_stages
   WHERE organization_id = p_org_id AND pipeline_type = p_pipe_type;

  DELETE FROM public.pipeline_display_config
   WHERE organization_id = p_org_id AND pipe_type = p_pipe_type;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DELETE do registro não afetou nenhuma linha' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_impact || jsonb_build_object(
    'automacoes_desativadas', v_wf,
    'disparos_neutralizados', 0,
    'agentes_ajustados',      v_cop
  );
END;
$function$;

-- Wrapper legado: impact custom por id. A checagem de type preserva o
-- contrato ("esta RPC nunca olha funil de sistema").
CREATE OR REPLACE FUNCTION public.custom_pipeline_delete_impact(p_pipeline_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- SCRUM-626: wrapper fino sobre pipeline_delete_impact.
  IF NOT EXISTS (SELECT 1 FROM public.pipelines
                  WHERE id = p_pipeline_id AND type = 'custom') THEN
    RAISE EXCEPTION 'funil não encontrado' USING ERRCODE = 'P0002';
  END IF;
  RETURN public.pipeline_delete_impact(p_pipeline_id);
END;
$function$;

-- Wrapper legado: delete custom por id. Idem: nunca apaga funil de sistema.
CREATE OR REPLACE FUNCTION public.delete_custom_pipeline(p_pipeline_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- SCRUM-626: wrapper fino sobre delete_pipeline.
  IF NOT EXISTS (SELECT 1 FROM public.pipelines
                  WHERE id = p_pipeline_id AND type = 'custom') THEN
    RAISE EXCEPTION 'funil não encontrado' USING ERRCODE = 'P0002';
  END IF;
  RETURN public.delete_pipeline(p_pipeline_id);
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- §5 · Bulk — motor único bulk_add_to_pipeline
-- ────────────────────────────────────────────────────────────────────────────
-- Avaliação da fusão (mandato da fatia): os dois bulks têm a MESMA semântica
-- (por lead: autoriza → valida alvo → move negócios ABERTOS → senão cria) e
-- divergiam só no vocabulário do alvo (slug+stage_key vs id+stage_id) e na
-- guarda de "aberto" (closed_at vs stage_role). FUNDE. O motor:
--   • alvo por (pipeline_id, stage_id) — funciona para QUALQUER funil; a
--     vitória da fusão é bulk em funil de sistema por id e em funil custom
--     pela mesma porta.
--   • guarda de aberto COMBINADA: closed_at IS NULL E etapa atual não é
--     won/lost. Divergência deliberada e medida (85 entries com closed_at NULL
--     paradas em won/lost): mover PARA FORA de won estorna venda de forma
--     irreversível (sale_reversed, trg_sale_events_immutable) — proteger essas
--     85 é correção, não regressão.
--   • UPDATE põe stage_id E stage_key no SET: mantém os AFTER ... OF stage_key
--     elegíveis (dispatch/workflow/checklist/história/venda) — mesmo racional
--     do INSTEAD OF de custom_pipe_entries (SCRUM-621).
--   • exige pipelines.is_active (contrato do bulk custom; 0 funis inativos
--     medidos em 2026-09-02 — nenhum comportamento observável muda).

CREATE FUNCTION public.bulk_add_to_pipeline(p_lead_ids uuid[], p_pipeline_id uuid, p_stage_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_is_master  boolean := public.is_master_user();
  v_member_org uuid;
  v_lead_id    uuid;
  v_lead_org   uuid;
  v_stage_key  text;
  v_movidos    integer;
BEGIN
  -- Membros: pinam a propria org. Master: sem pin (escopo limitado por p_lead_ids).
  IF NOT v_is_master THEN
    SELECT tm.organization_id INTO v_member_org
    FROM public.team_members tm
    WHERE tm.user_id = auth.uid() AND tm.is_active = true
    LIMIT 1;

    IF v_member_org IS NULL THEN
      RAISE EXCEPTION 'No active organization membership';
    END IF;
  END IF;

  FOREACH v_lead_id IN ARRAY p_lead_ids LOOP
    -- Org do lead + autorizacao (membro: so a propria org; master: qualquer org)
    SELECT l.organization_id INTO v_lead_org
    FROM public.leads l
    WHERE l.id = v_lead_id
      AND l.deleted_at IS NULL
      AND (v_is_master OR l.organization_id = v_member_org);

    IF v_lead_org IS NULL THEN
      CONTINUE;  -- inexistente, deletado, ou sem permissao
    END IF;

    -- Funil alvo (qualquer tipo) deve pertencer a org do lead e estar ativo.
    IF NOT EXISTS (
      SELECT 1 FROM public.pipelines p
      WHERE p.id = p_pipeline_id
        AND p.organization_id = v_lead_org
        AND p.is_active = true
    ) THEN
      CONTINUE;
    END IF;

    -- Etapa alvo deve pertencer ao funil; a key entra no SET (ver cabeçalho).
    SELECT ps.stage_key INTO v_stage_key
    FROM public.pipeline_stages ps
    WHERE ps.id = p_stage_id
      AND ps.pipeline_id = p_pipeline_id;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    -- Move todos os negócios ABERTOS do lead nesse funil (decisão CTO
    -- 2026-07-31; guarda combinada — ver cabeçalho da função).
    UPDATE public.pipeline_entries pe
       SET stage_id         = p_stage_id,
           stage_key        = v_stage_key,
           stage_changed_at = now(),
           updated_at       = now()
     WHERE pe.pipeline_id     = p_pipeline_id
       AND pe.lead_id         = v_lead_id
       AND pe.organization_id = v_lead_org
       AND pe.closed_at IS NULL
       AND NOT EXISTS (
         SELECT 1
         FROM public.pipeline_stages cs
         WHERE cs.id = pe.stage_id
           AND cs.stage_role IN ('won', 'lost')
       );

    GET DIAGNOSTICS v_movidos = ROW_COUNT;

    -- Só insere quando não havia negócio aberto — recompra continua abrindo
    -- um segundo negócio sem tocar no fechado (racional íntegro no baseline).
    IF v_movidos = 0 THEN
      INSERT INTO public.pipeline_entries (
        organization_id, pipeline_id, lead_id, stage_id, stage_key, entered_at, stage_changed_at
      ) VALUES (
        v_lead_org, p_pipeline_id, v_lead_id, p_stage_id, v_stage_key, now(), now()
      );
    END IF;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.bulk_add_to_pipeline FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bulk_add_to_pipeline FROM anon;
GRANT EXECUTE ON FUNCTION public.bulk_add_to_pipeline TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_add_to_pipeline TO service_role;

-- Wrapper legado: bulk custom por id. A checagem de type preserva o contrato
-- (esta assinatura nunca adicionou a funil de sistema; skip silencioso, como
-- toda validação de alvo do baseline).
CREATE OR REPLACE FUNCTION public.bulk_add_to_custom_pipe(p_lead_ids uuid[], p_pipeline_id uuid, p_stage_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- SCRUM-626: wrapper fino sobre bulk_add_to_pipeline.
  IF NOT EXISTS (SELECT 1 FROM public.pipelines
                  WHERE id = p_pipeline_id AND type = 'custom') THEN
    RETURN;
  END IF;
  PERFORM public.bulk_add_to_pipeline(p_lead_ids, p_pipeline_id, p_stage_id);
END;
$function$;

-- Wrapper legado: bulk system por (slug, stage_key). Resolve por lead (a org
-- do lead manda — arrays multi-org de master continuam funcionando) e delega
-- lead a lead ao motor. Divergência deliberada: alvo com stage_key sem linha
-- em pipeline_stages agora é SKIP (o baseline escrevia a key às cegas e criava
-- card fantasma); o board só oferece etapas que existem, então o caminho de UI
-- não muda.
CREATE OR REPLACE FUNCTION public.bulk_move_stage(p_lead_ids uuid[], p_target_pipe text, p_target_stage text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_is_master   boolean := public.is_master_user();
  v_member_org  uuid;
  v_lead_id     uuid;
  v_lead_org    uuid;
  v_pipeline_id uuid;
  v_stage_id    uuid;
BEGIN
  -- Membros: pinam a propria org. Master: sem pin (escopo limitado por p_lead_ids).
  IF NOT v_is_master THEN
    SELECT tm.organization_id INTO v_member_org
    FROM public.team_members tm
    WHERE tm.user_id = auth.uid() AND tm.is_active = true
    LIMIT 1;

    IF v_member_org IS NULL THEN
      RAISE EXCEPTION 'No active organization membership';
    END IF;
  END IF;

  FOREACH v_lead_id IN ARRAY p_lead_ids LOOP
    SELECT l.organization_id INTO v_lead_org
    FROM public.leads l
    WHERE l.id = v_lead_id
      AND l.deleted_at IS NULL
      AND (v_is_master OR l.organization_id = v_member_org);

    IF v_lead_org IS NULL THEN
      CONTINUE;  -- inexistente, deletado, ou sem permissao
    END IF;

    -- SCRUM-626: resolução de REGISTRO por (org, slug) — ver nota de lint §4.
    SELECT p.id INTO v_pipeline_id
    FROM public.pipelines p
    WHERE p.slug = p_target_pipe
      AND p.organization_id = v_lead_org
      AND p.type <> 'custom'
    LIMIT 1;

    IF v_pipeline_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT ps.id INTO v_stage_id
    FROM public.pipeline_stages ps
    WHERE ps.pipeline_id = v_pipeline_id
      AND ps.stage_key = p_target_stage;

    IF v_stage_id IS NULL THEN
      CONTINUE;  -- etapa fantasma: ver divergência documentada no cabeçalho
    END IF;

    PERFORM public.bulk_add_to_pipeline(ARRAY[v_lead_id], v_pipeline_id, v_stage_id);
  END LOOP;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- §6 · Asserções — a migration se recusa a concluir errada
-- ────────────────────────────────────────────────────────────────────────────
DO $assert$
DECLARE
  v_n int;
  r   record;
BEGIN
  -- 6.1 As 6 funções novas existem, uma vez cada (sem overload acidental).
  FOR r IN
    SELECT unnest(ARRAY[
      'get_pipeline_stage_counts_by_id',
      'get_pipeline_lead_ids',
      'pipeline_delete_impact',
      'delete_pipeline',
      'bulk_add_to_pipeline']) AS fn
  LOOP
    SELECT count(*) INTO v_n
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = r.fn;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'SCRUM-626: % tem % definições (esperado 1)', r.fn, v_n;
    END IF;
  END LOOP;

  -- get_pipeline_page: exatamente 1 assinatura (a velha caiu, a nova entrou)
  -- e com o parâmetro novo.
  SELECT count(*) INTO v_n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_pipeline_page';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'SCRUM-626: get_pipeline_page tem % assinaturas (esperado 1 — DROP falhou?)', v_n;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'get_pipeline_page'
       AND 'p_pipeline_id' = ANY(p.proargnames)
  ) THEN
    RAISE EXCEPTION 'SCRUM-626: get_pipeline_page sem p_pipeline_id';
  END IF;

  -- 6.2 SECURITY DEFINER onde tem de ter (e só onde tem de ter).
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('pipeline_delete_impact','delete_pipeline','bulk_add_to_pipeline')
       AND NOT p.prosecdef
  ) THEN
    RAISE EXCEPTION 'SCRUM-626: função de escrita nova sem SECURITY DEFINER';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('get_pipeline_page','get_pipeline_stage_counts_by_id','get_pipeline_lead_ids')
       AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'SCRUM-626: função de leitura nova com SECURITY DEFINER indevido';
  END IF;

  -- 6.3 Matriz de grants (DROP+CREATE reseta ACL — regra da casa; aqui é lei).
  FOR r IN
    SELECT * FROM (VALUES
      ('get_pipeline_page',                false, true),
      ('get_pipeline_stage_counts_by_id',  false, true),
      ('get_pipeline_lead_ids',            true,  true),
      ('pipeline_delete_impact',           false, true),
      ('delete_pipeline',                  false, true),
      ('bulk_add_to_pipeline',             false, true),
      -- wrappers: ACL de prod preservada pelo CREATE OR REPLACE
      ('get_pipeline_stage_counts',        false, true),
      ('get_custom_pipeline_stage_counts', true,  true),
      ('get_stage_lead_ids',               true,  true),
      ('get_filtered_lead_ids',            true,  true),
      ('get_custom_filtered_lead_ids',     true,  true),
      ('system_pipeline_delete_impact',    false, true),
      ('delete_system_pipeline',           false, true),
      ('custom_pipeline_delete_impact',    false, true),
      ('delete_custom_pipeline',           false, true),
      ('bulk_move_stage',                  false, true),
      ('bulk_add_to_custom_pipe',          false, true)
    ) AS g(fn, anon_deve, auth_deve)
  LOOP
    FOR v_n IN
      SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = r.fn
    LOOP
      IF has_function_privilege('anon', v_n::oid, 'EXECUTE') IS DISTINCT FROM r.anon_deve THEN
        RAISE EXCEPTION 'SCRUM-626: grant de anon errado em % (esperado %)', r.fn, r.anon_deve;
      END IF;
      IF has_function_privilege('authenticated', v_n::oid, 'EXECUTE') IS DISTINCT FROM r.auth_deve THEN
        RAISE EXCEPTION 'SCRUM-626: grant de authenticated errado em % (esperado %)', r.fn, r.auth_deve;
      END IF;
      IF NOT has_function_privilege('service_role', v_n::oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'SCRUM-626: service_role sem EXECUTE em %', r.fn;
      END IF;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'SCRUM-626: RPCs fundidas por pipeline_id — asserções OK';
END;
$assert$;
