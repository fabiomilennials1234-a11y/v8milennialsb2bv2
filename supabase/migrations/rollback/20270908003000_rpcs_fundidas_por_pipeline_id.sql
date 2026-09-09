-- rollback/20270908003000_rpcs_fundidas_por_pipeline_id.sql — SCRUM-626
--
-- Reverte a fusão das RPCs por pipeline_id: derruba as 6 funções novas e
-- restaura as 12 definições EXATAS de prod (snapshot pg_get_functiondef,
-- 2026-09-02, ledger topo 20270908002000). Nenhum dado muda — a migration é
-- 100% de funções.
--
-- Grants: os 11 wrappers voltam por CREATE OR REPLACE (ACL intacta).
-- get_pipeline_page precisa de DROP (a assinatura com p_pipeline_id não é
-- substituível) + CREATE + re-grant explícito espelhando prod.
--
-- ORDEM: derrubar wrappers-fundidos primeiro seria errado — os wrappers são
-- CREATE OR REPLACE por cima, então basta (1) restaurar os 12 corpos,
-- (2) dropar as 6 funções novas (nenhum wrapper restaurado as referencia).
--
-- metric-lint-allow: rollback restaura corpos VERBATIM do baseline de prod,
-- incluindo os predicados type='system' históricos — não é métrica nova.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

-- Guarda: só roda por cima do estado pós-migration.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='delete_pipeline') THEN
    RAISE EXCEPTION 'ROLLBACK SCRUM-626: delete_pipeline não existe — migration não aplicada?';
  END IF;
END;
$$;

-- ── 1) get_pipeline_page: DROP da assinatura nova + CREATE do snapshot ──────
DROP FUNCTION IF EXISTS public.get_pipeline_page(text, text, uuid, integer, timestamptz, text, uuid, uuid[], text[], integer, integer, integer, integer, text, text, timestamptz, timestamptz, timestamptz, timestamptz, text[], timestamptz, text[], text[], boolean, text[], text[], integer, integer, uuid);

CREATE OR REPLACE FUNCTION public.get_pipeline_page(p_pipeline_slug text, p_stage_id text, p_org_id uuid, p_page_size integer DEFAULT 20, p_cursor timestamp with time zone DEFAULT NULL::timestamp with time zone, p_search text DEFAULT NULL::text, p_responsible_id uuid DEFAULT NULL::uuid, p_tag_ids uuid[] DEFAULT NULL::uuid[], p_origins text[] DEFAULT NULL::text[], p_rating_min integer DEFAULT NULL::integer, p_rating_max integer DEFAULT NULL::integer, p_calor_min integer DEFAULT NULL::integer, p_calor_max integer DEFAULT NULL::integer, p_urgency text DEFAULT NULL::text, p_product_type text DEFAULT NULL::text, p_meeting_after timestamp with time zone DEFAULT NULL::timestamp with time zone, p_meeting_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_period_after timestamp with time zone DEFAULT NULL::timestamp with time zone, p_period_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_closed_status_keys text[] DEFAULT NULL::text[], p_updated_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_overdue_exclude_status_keys text[] DEFAULT NULL::text[], p_status_keys text[] DEFAULT NULL::text[], p_scheduled boolean DEFAULT NULL::boolean, p_qualification_tier text[] DEFAULT NULL::text[], p_pre_qualification_tier text[] DEFAULT NULL::text[], p_stalled_min_days integer DEFAULT NULL::integer, p_stalled_max_days integer DEFAULT NULL::integer)
 RETURNS TABLE(id uuid, pipeline_id uuid, lead_id uuid, stage_key text, assigned_to uuid, notes text, metadata jsonb, entered_at timestamp with time zone, stage_changed_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone, lead jsonb)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE v_pipeline_id UUID;
BEGIN
  SELECT p.id INTO v_pipeline_id FROM public.pipelines p WHERE p.slug=p_pipeline_slug AND p.type='system' AND p.organization_id=p_org_id; -- metric-lint-allow: corpo preservado da função original; funil custom tem caminho próprio (CustomPipelineKanban), mudar a resolução aqui seria alteração de comportamento fora do escopo deste filtro
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
    AND (p_updated_before IS NULL OR (pe.updated_at <= p_updated_before AND (p_overdue_exclude_status_keys IS NULL OR pe.stage_key <> ALL(p_overdue_exclude_status_keys)))) -- metric-lint-allow: não é âncora de métrica — é o filtro de lista "sem toque desde" (p_updated_before, coluna "Vencidos" da página de funil). O R4 existe para que receita/venda não troque de mês quando alguém encosta na linha; aqui o último toque é exatamente a pergunta que o usuário faz. A âncora de período desta mesma query continua em metrics_period_at (ver linha acima).
    AND (p_status_keys IS NULL OR array_length(p_status_keys, 1) IS NULL OR pe.stage_key = ANY(p_status_keys))
    AND (NOT COALESCE(p_scheduled, FALSE) OR EXISTS (SELECT 1 FROM public.scheduled_user_messages sm WHERE sm.lead_id = l.id AND sm.organization_id = p_org_id AND sm.status = 'scheduled'))
    -- "Parado há": idade na etapa atual. min = piso (>= N dias completos);
    -- max = teto (ainda não completou N+1).
    AND (p_stalled_min_days IS NULL OR COALESCE(pe.stage_changed_at, pe.entered_at, pe.created_at) <= now() - make_interval(days => p_stalled_min_days))
    AND (p_stalled_max_days IS NULL OR COALESCE(pe.stage_changed_at, pe.entered_at, pe.created_at) > now() - make_interval(days => p_stalled_max_days + 1))
  ORDER BY pe.created_at DESC LIMIT p_page_size;
END;
$function$

;

-- ACL de prod (snapshot): authenticated + service_role, sem anon/PUBLIC.
REVOKE ALL ON FUNCTION public.get_pipeline_page FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_pipeline_page FROM anon;
GRANT EXECUTE ON FUNCTION public.get_pipeline_page TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pipeline_page TO service_role;

-- ── 2) Wrappers de volta aos corpos de prod (CREATE OR REPLACE, ACL intacta) ─
CREATE OR REPLACE FUNCTION public.get_pipeline_stage_counts(p_pipeline_slug text, p_org_id uuid, p_search text DEFAULT NULL::text, p_responsible_id uuid DEFAULT NULL::uuid, p_tag_ids uuid[] DEFAULT NULL::uuid[], p_origins text[] DEFAULT NULL::text[], p_rating_min integer DEFAULT NULL::integer, p_rating_max integer DEFAULT NULL::integer, p_calor_min integer DEFAULT NULL::integer, p_calor_max integer DEFAULT NULL::integer, p_urgency text DEFAULT NULL::text, p_product_type text DEFAULT NULL::text, p_meeting_after timestamp with time zone DEFAULT NULL::timestamp with time zone, p_meeting_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_period_after timestamp with time zone DEFAULT NULL::timestamp with time zone, p_period_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_closed_status_keys text[] DEFAULT NULL::text[], p_updated_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_overdue_exclude_status_keys text[] DEFAULT NULL::text[], p_status_keys text[] DEFAULT NULL::text[], p_scheduled boolean DEFAULT NULL::boolean, p_qualification_tier text[] DEFAULT NULL::text[], p_pre_qualification_tier text[] DEFAULT NULL::text[], p_stalled_min_days integer DEFAULT NULL::integer, p_stalled_max_days integer DEFAULT NULL::integer)
 RETURNS TABLE(stage_key text, cnt bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE v_pipeline_id UUID;
BEGIN
  SELECT p.id INTO v_pipeline_id FROM public.pipelines p WHERE p.slug=p_pipeline_slug AND p.type='system' AND p.organization_id=p_org_id; -- metric-lint-allow: corpo preservado da função original; ver nota em get_pipeline_page acima
  IF v_pipeline_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT pe.stage_key, COUNT(*)::BIGINT AS cnt
  FROM public.pipeline_entries pe
  JOIN public.leads l ON l.id = pe.lead_id
  WHERE pe.pipeline_id = v_pipeline_id AND pe.organization_id = p_org_id AND pe.lead_id IS NOT NULL
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
    AND (p_updated_before IS NULL OR (pe.updated_at <= p_updated_before AND (p_overdue_exclude_status_keys IS NULL OR pe.stage_key <> ALL(p_overdue_exclude_status_keys)))) -- metric-lint-allow: não é âncora de métrica — é o filtro de lista "sem toque desde" (p_updated_before, coluna "Vencidos" da página de funil). O R4 existe para que receita/venda não troque de mês quando alguém encosta na linha; aqui o último toque é exatamente a pergunta que o usuário faz. A âncora de período desta mesma query continua em metrics_period_at (ver linha acima).
    AND (p_status_keys IS NULL OR array_length(p_status_keys, 1) IS NULL OR pe.stage_key = ANY(p_status_keys))
    AND (NOT COALESCE(p_scheduled, FALSE) OR EXISTS (SELECT 1 FROM public.scheduled_user_messages sm WHERE sm.lead_id = l.id AND sm.organization_id = p_org_id AND sm.status = 'scheduled'))
    AND (p_stalled_min_days IS NULL OR COALESCE(pe.stage_changed_at, pe.entered_at, pe.created_at) <= now() - make_interval(days => p_stalled_min_days))
    AND (p_stalled_max_days IS NULL OR COALESCE(pe.stage_changed_at, pe.entered_at, pe.created_at) > now() - make_interval(days => p_stalled_max_days + 1))
  GROUP BY pe.stage_key;
END;
$function$

;

CREATE OR REPLACE FUNCTION public.get_custom_pipeline_stage_counts(p_pipeline_id uuid, p_org_id uuid, p_search text DEFAULT NULL::text)
 RETURNS TABLE(stage_id uuid, cnt bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    cpe.stage_id,
    COUNT(*)::BIGINT AS cnt
  FROM public.custom_pipe_entries cpe
  -- INNER: entry cujo lead a RLS nega não é contada, espelhando
  -- get_pipeline_stage_counts. Era LEFT JOIN.
  JOIN public.leads l ON l.id = cpe.lead_id
  WHERE cpe.pipeline_id = p_pipeline_id
    AND cpe.organization_id = p_org_id
    AND (p_search IS NULL OR p_search = '' OR (
      l.name ILIKE '%' || p_search || '%'
      OR l.phone ILIKE '%' || p_search || '%'
      OR l.company ILIKE '%' || p_search || '%'
    ))
  GROUP BY cpe.stage_id;
END;
$function$

;

CREATE OR REPLACE FUNCTION public.get_stage_lead_ids(p_pipeline_type text, p_stage_key text, p_organization_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT pe.lead_id
  FROM public.pipeline_entries pe
  JOIN public.pipelines p
    ON p.id = pe.pipeline_id
   AND p.type = 'system' -- metric-lint-allow: resolver de PÚBLICO de disparo, não métrica — e o corpo é cópia VERBATIM do baseline 20260101000000, que já vivia com este predicado. O par type+slug seleciona O funil que o operador escolheu na tela; funil custom tem resolver próprio (get_custom_filtered_lead_ids), logo nenhum é cegado — que é o que a regra R3 protege.
   AND p.slug = p_pipeline_type
  JOIN public.leads l
    ON l.id = pe.lead_id
   AND l.deleted_at IS NULL
  WHERE pe.stage_key = p_stage_key
    AND pe.lead_id IS NOT NULL
    -- AUTORIZAÇÃO: orgs do chamador (helper) OU a org pedida quando master.
    AND (
      pe.organization_id IN (SELECT public.get_my_organization_ids())
      OR (p_organization_id IS NOT NULL
          AND public.is_master_user()
          AND pe.organization_id = p_organization_id)
    )
    -- ESCOPO (SCRUM-429): quem passou a org quer AQUELA org, não a união.
    AND (p_organization_id IS NULL OR pe.organization_id = p_organization_id);
$function$

;

CREATE OR REPLACE FUNCTION public.get_filtered_lead_ids(p_pipeline_type text, p_stage_key text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_responsible_id uuid DEFAULT NULL::uuid, p_tag_ids uuid[] DEFAULT NULL::uuid[], p_qualification_tier text[] DEFAULT NULL::text[], p_pre_qualification_tier text[] DEFAULT NULL::text[], p_origin text[] DEFAULT NULL::text[], p_organization_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT pe.lead_id
  FROM public.pipeline_entries pe
  JOIN public.pipelines p
    ON p.id = pe.pipeline_id
   AND p.type = 'system' -- metric-lint-allow: resolver de PÚBLICO de disparo, não métrica — e o corpo é cópia VERBATIM do baseline 20260101000000, que já vivia com este predicado. O par type+slug seleciona O funil que o operador escolheu na tela; funil custom tem resolver próprio (get_custom_filtered_lead_ids), logo nenhum é cegado — que é o que a regra R3 protege.
   AND p.slug = p_pipeline_type
  JOIN public.leads l
    ON l.id = pe.lead_id
   AND l.deleted_at IS NULL
  WHERE pe.lead_id IS NOT NULL
    -- AUTORIZAÇÃO: orgs do chamador (helper) OU a org pedida quando master.
    AND (
      pe.organization_id IN (SELECT public.get_my_organization_ids())
      OR (p_organization_id IS NOT NULL
          AND public.is_master_user()
          AND pe.organization_id = p_organization_id)
    )
    -- ESCOPO (SCRUM-429): quem passou a org quer AQUELA org, não a união.
    AND (p_organization_id IS NULL OR pe.organization_id = p_organization_id)
    -- Optional stage scope: NULL = whole pipeline (every stage).
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
$function$

;

CREATE OR REPLACE FUNCTION public.get_custom_filtered_lead_ids(p_pipeline_id uuid, p_stage_id uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text, p_responsible_id uuid DEFAULT NULL::uuid, p_tag_ids uuid[] DEFAULT NULL::uuid[], p_qualification_tier text[] DEFAULT NULL::text[], p_pre_qualification_tier text[] DEFAULT NULL::text[], p_origin text[] DEFAULT NULL::text[], p_organization_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT ce.lead_id
  FROM public.custom_pipe_entries ce
  JOIN public.leads l
    ON l.id = ce.lead_id
   AND l.deleted_at IS NULL
  WHERE ce.lead_id IS NOT NULL
    AND ce.pipeline_id = p_pipeline_id
    -- AUTORIZAÇÃO: orgs do chamador (helper) OU a org pedida quando master.
    AND (
      ce.organization_id IN (SELECT public.get_my_organization_ids())
      OR (p_organization_id IS NOT NULL
          AND public.is_master_user()
          AND ce.organization_id = p_organization_id)
    )
    -- ESCOPO (SCRUM-429): quem passou a org quer AQUELA org, não a união.
    AND (p_organization_id IS NULL OR ce.organization_id = p_organization_id)
    -- Optional stage scope: NULL = whole pipeline (every stage).
    AND (p_stage_id IS NULL OR ce.stage_id = p_stage_id)
    -- Search filter (mirrors get_filtered_lead_ids: name / phone / company).
    AND (p_search IS NULL OR p_search = '' OR (
      l.name    ILIKE '%' || p_search || '%'
      OR l.phone   ILIKE '%' || p_search || '%'
      OR l.company ILIKE '%' || p_search || '%'
    ))
    -- Responsible filter (lead columns only — see 20261123000001 header note).
    AND (p_responsible_id IS NULL OR (
      l.pre_sale_responsible_id = p_responsible_id
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
$function$

;

CREATE OR REPLACE FUNCTION public.system_pipeline_delete_impact(p_org_id uuid, p_pipe_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pipeline_id uuid;
  v_cards       bigint := 0;
  v_leads       bigint := 0;
BEGIN
  IF p_pipe_type NOT IN ('whatsapp', 'confirmacao', 'propostas', 'upsell') THEN
    RAISE EXCEPTION 'tipo de funil de sistema desconhecido: %', p_pipe_type
      USING ERRCODE = 'P0002';
  END IF;

  -- SECURITY DEFINER bypassa RLS: a autorização é reimplementada aqui.
  -- `current_setting('role')` é a convenção do repo para a chave de serviço;
  -- numa conexão direta (Management API) ela vale 'none', não 'service_role'.
  IF NOT (p_org_id IN (SELECT public.get_my_organization_ids())
          OR public.is_master_user()
          OR current_setting('role', true) = 'service_role') THEN
    RAISE EXCEPTION 'sem permissão sobre esta organização' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_pipeline_id
    FROM public.pipelines
   WHERE organization_id = p_org_id AND slug = p_pipe_type AND type = 'system'; -- metric-lint-allow: não é métrica — é a resolução da linha de REGISTRO do funil de sistema que está sendo excluído. Parametrizar por pipeline_id é impossível: é exatamente o id que esta linha existe para descobrir, a partir do par (org, pipe_type) que o usuário escolheu na tela.

  -- Contagem de cards: cada tipo tem a sua própria tabela, sem coluna comum
  -- para parametrizar. Três ramos explícitos em vez de EXECUTE com nome de
  -- tabela interpolado — mais longo, e sem superfície de injeção.
  IF p_pipe_type = 'whatsapp' THEN
    SELECT count(*), count(DISTINCT lead_id) INTO v_cards, v_leads
      FROM public.pipe_whatsapp WHERE organization_id = p_org_id;
  ELSIF p_pipe_type = 'confirmacao' THEN
    SELECT count(*), count(DISTINCT lead_id) INTO v_cards, v_leads
      FROM public.pipe_confirmacao WHERE organization_id = p_org_id;
  ELSIF p_pipe_type = 'propostas' THEN
    SELECT count(*), count(DISTINCT lead_id) INTO v_cards, v_leads
      FROM public.pipe_propostas WHERE organization_id = p_org_id;
  END IF;
  -- `upsell` não tem tabela de cards: a Carteira é faceta do lead, não funil.

  RETURN jsonb_build_object(
    'pipe_type',   p_pipe_type,
    'pipeline_id', v_pipeline_id,
    'cards',       v_cards,
    'leads',       v_leads,
    'etapas',
      (SELECT count(*) FROM public.pipeline_stages
        WHERE organization_id = p_org_id AND pipeline_type = p_pipe_type),
    -- ADR-0017: some por CASCADE e não tem backup lógico.
    'eventos_etapa',
      (SELECT count(*) FROM public.pipeline_stage_events
        WHERE pipeline_id = v_pipeline_id),
    -- Sem FK para pipelines: sobrevive com ponteiro morto.
    'vendas_orfas',
      (SELECT count(*) FROM public.sale_events
        WHERE pipeline_id = v_pipeline_id),
    -- 🚨 Casa os DOIS jeitos de citar o funil. Medido em prod: das 30 automações
    -- com `filter_pipe`, 14 NÃO têm `filter_pipeline_id` — casar só pelo uuid
    -- deixaria quase metade delas viva e apontando para o vazio. E o slug vem
    -- COM prefixo (`pipe_whatsapp`) no gatilho `lead_created` e SEM prefixo no
    -- `stage_changed`/`scheduled_date`; por isso as duas formas entram.
    'automacoes',
      (SELECT count(*) FROM public.workflows w
        WHERE w.organization_id = p_org_id
          AND w.is_active
          AND (w.trigger_config->>'filter_pipe' IN (p_pipe_type, 'pipe_' || p_pipe_type)
            OR (v_pipeline_id IS NOT NULL
                AND (strpos(w.definition::text, v_pipeline_id::text) > 0
                  OR strpos(w.trigger_config::text, v_pipeline_id::text) > 0)))),
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
    -- Agentes de IA que operam este funil. O gatilho de etapa limpa
    -- active_stages/move_rules; `active_pipes` é limpo pela RPC.
    'agentes_copilot',
      (SELECT count(*) FROM public.copilot_agents
        WHERE organization_id = p_org_id AND active_pipes ? p_pipe_type)
  );
END;
$function$

;

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
  v_bp          integer := 0;
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

  SELECT id INTO v_pipeline_id
    FROM public.pipelines
   WHERE organization_id = p_org_id AND slug = p_pipe_type AND type = 'system' -- metric-lint-allow: não é métrica — é a resolução da linha de REGISTRO do funil de sistema que está sendo excluído, travada com FOR UPDATE. Parametrizar por pipeline_id é impossível: é exatamente o id que esta linha existe para descobrir, a partir do par (org, pipe_type) escolhido na tela.
     FOR UPDATE;

  -- Medir ANTES de apagar — depois os números seriam todos zero.
  v_impact := public.system_pipeline_delete_impact(p_org_id, p_pipe_type);

  -- (a) Automações que citam o funil param de disparar EM SILÊNCIO (o motor só
  --     compara e devolve `false`). Desativar é honesto: aparece desligada na
  --     tela, em vez de "ligada e morta". NÃO reescrevemos o JSON — mexer no
  --     grafo às cegas corrompe a automação.
  UPDATE public.workflows w
     SET is_active = false,
         updated_at = now()
   WHERE w.organization_id = p_org_id
     AND w.is_active
     AND (w.trigger_config->>'filter_pipe' IN (p_pipe_type, 'pipe_' || p_pipe_type)
       OR (v_pipeline_id IS NOT NULL
           AND (strpos(w.definition::text, v_pipeline_id::text) > 0
             OR strpos(w.trigger_config::text, v_pipeline_id::text) > 0)));
  GET DIAGNOSTICS v_wf = ROW_COUNT;

  -- (b) Disparo em voo com destino neste funil: o release diário NÃO revalida
  --     o destino, então entregaria a mensagem e não moveria ninguém.
  --     NULL = "mantém o lead onde está".
  IF v_pipeline_id IS NOT NULL THEN
    UPDATE public.blast_plans
       SET post_send_target = NULL,
           updated_at = now()
     WHERE organization_id = p_org_id
       AND status IN ('active', 'paused')
       AND post_send_target->>'pipelineId' = v_pipeline_id::text;
    GET DIAGNOSTICS v_bp = ROW_COUNT;
  END IF;

  -- (c) Agente de IA que operava o funil. Nenhum gatilho limpa `active_pipes`
  --     (o de etapa só mexe em `active_stages`/`move_rules`), então sem isto
  --     sobraria Copilot configurado para um funil inexistente.
  UPDATE public.copilot_agents
     SET active_pipes  = active_pipes - p_pipe_type,
         active_stages = COALESCE(active_stages, '{}'::jsonb) - p_pipe_type,
         updated_at    = now()
   WHERE organization_id = p_org_id
     AND active_pipes ? p_pipe_type;
  GET DIAGNOSTICS v_cop = ROW_COUNT;

  -- (d) Regras e mensagens em voo, chaveadas por (org, pipe_type).
  --     Passos antes das regras: a FK filha não declara ON DELETE.
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

  -- (e) 🚨 O ESPELHO NO LEAD, À MÃO — e ANTES dos cards.
  --
  --     `leads.pipe_whatsapp` guarda a etapa do lead no funil de sistema
  --     WhatsApp. Existe um gatilho para mantê-lo
  --     (`trg_sync_whatsapp_stage_to_lead`, DELETE em `pipeline_entries`), e
  --     ele NÃO roda neste caminho. A primeira linha da função é:
  --
  --         IF pg_trigger_depth() > 1 THEN ... RETURN; END IF;
  --
  --     uma trava contra reentrância, posta por causa do sync com
  --     `custom_pipe_entries`. Só que apagar `pipe_whatsapp` dispara
  --     `pipe_whatsapp_delete_fn`, que apaga `pipeline_entries` — já em
  --     profundidade 2. A trava bate, a função retorna e o espelho nunca é
  --     limpo.
  --
  --     Medido no ensaio contra prod: sem esta linha, a exclusão do funil da
  --     Milennials deixava **1.248 leads** com `pipe_whatsapp` apontando para a
  --     etapa de um funil inexistente. A asserção do ensaio pegou; reordenar os
  --     deletes NÃO resolvia, porque o problema nunca foi a ordem — era a trava
  --     de profundidade. Depender do gatilho aqui seria depender de código que
  --     comprovadamente não executa.
  IF p_pipe_type = 'whatsapp' THEN
    UPDATE public.leads
       SET pipe_whatsapp = NULL
     WHERE organization_id = p_org_id
       AND pipe_whatsapp IS NOT NULL;
  END IF;

  -- (f) Os cards.
  IF p_pipe_type = 'propostas' THEN
    -- `pipe_proposta_items.pipe_proposta_id` NÃO tem FK: ninguém apaga por nós.
    DELETE FROM public.pipe_proposta_items
     WHERE pipe_proposta_id IN (SELECT id FROM public.pipe_propostas
                                 WHERE organization_id = p_org_id);
    DELETE FROM public.pipe_propostas   WHERE organization_id = p_org_id;
  ELSIF p_pipe_type = 'confirmacao' THEN
    DELETE FROM public.pipe_confirmacao WHERE organization_id = p_org_id;
  ELSIF p_pipe_type = 'whatsapp' THEN
    DELETE FROM public.pipe_whatsapp    WHERE organization_id = p_org_id;
  END IF;

  -- (g) As etapas. Dispara `on_pipeline_stage_removed`, que limpa as regras de
  --     kanban do Copilot, e `trg_queue_followup_reclassify`.
  DELETE FROM public.pipeline_stages
   WHERE organization_id = p_org_id AND pipeline_type = p_pipe_type;

  -- (h) A linha de registro em `pipelines`. Leva por CASCADE o que sobrou de
  --     `pipeline_entries` (entry sem card, se houver) e `pipeline_stage_events`.
  IF v_pipeline_id IS NOT NULL THEN
    DELETE FROM public.pipelines WHERE id = v_pipeline_id;
  END IF;

  -- (i) O registro. É ESTE delete que impede o funil de voltar: sem a linha,
  --     `create_default_pipelines` não recria o espelho e o front não semeia
  --     etapa (20270902000000).
  DELETE FROM public.pipeline_display_config
   WHERE organization_id = p_org_id AND pipe_type = p_pipe_type;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DELETE do registro não afetou nenhuma linha' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_impact || jsonb_build_object(
    'automacoes_desativadas', v_wf,
    'disparos_neutralizados', v_bp,
    'agentes_ajustados',      v_cop
  );
END;
$function$

;

CREATE OR REPLACE FUNCTION public.custom_pipeline_delete_impact(p_pipeline_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid;
BEGIN
  SELECT organization_id INTO v_org
    FROM public.custom_pipelines
   WHERE id = p_pipeline_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'funil não encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (v_org IN (SELECT public.get_my_organization_ids())
          OR public.is_master_user()
          OR current_setting('role', true) = 'service_role') THEN
    RAISE EXCEPTION 'sem permissão sobre este funil' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'cards',
      (SELECT count(*) FROM public.custom_pipe_entries
        WHERE pipeline_id = p_pipeline_id),
    'leads',
      (SELECT count(DISTINCT lead_id) FROM public.custom_pipe_entries
        WHERE pipeline_id = p_pipeline_id),
    'etapas',
      (SELECT count(*) FROM public.custom_pipeline_stages
        WHERE pipeline_id = p_pipeline_id),
    'membros',
      (SELECT count(*) FROM public.custom_pipeline_members
        WHERE pipeline_id = p_pipeline_id),
    'eventos_etapa',
      (SELECT count(*) FROM public.pipeline_stage_events
        WHERE pipeline_id = p_pipeline_id),
    'vendas_orfas',
      (SELECT count(*) FROM public.sale_events
        WHERE pipeline_id = p_pipeline_id),
    'negocios_orfaos',
      (SELECT count(DISTINCT deal_id) FROM public.custom_pipe_entries
        WHERE pipeline_id = p_pipeline_id AND deal_id IS NOT NULL),
    -- NOVO: card de outro funil pousado numa etapa deste. > 0 impede o delete.
    'cards_invasores',
      (SELECT count(*) FROM public.custom_pipe_entries e
         JOIN public.custom_pipeline_stages s ON s.id = e.stage_id
        WHERE s.pipeline_id = p_pipeline_id
          AND e.pipeline_id <> p_pipeline_id),
    'automacoes',
      (SELECT count(*) FROM public.workflows w
        WHERE w.organization_id = v_org
          AND w.is_active
          AND (strpos(w.definition::text, p_pipeline_id::text) > 0
            OR strpos(w.trigger_config::text, p_pipeline_id::text) > 0)),
    'disparos_em_voo',
      (SELECT count(*) FROM public.blast_plans b
        WHERE b.organization_id = v_org
          AND b.status IN ('active', 'paused')
          AND b.post_send_target->>'pipelineId' = p_pipeline_id::text)
  );
END;
$function$

;

CREATE OR REPLACE FUNCTION public.delete_custom_pipeline(p_pipeline_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org       uuid;
  v_impact    jsonb;
  v_wf        integer := 0;
  v_bp        integer := 0;
  v_invasores integer := 0;
  v_exemplo   text;
BEGIN
  -- SCRUM-621: lock direto na fonte (view não trava linha); o predicado
  -- type='custom' preserva o contrato — esta RPC nunca apaga funil de sistema.
  SELECT organization_id INTO v_org
    FROM public.pipelines
   WHERE id = p_pipeline_id
     AND type = 'custom'
     FOR UPDATE;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'funil não encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (v_org IN (SELECT public.get_my_organization_ids())
          OR public.is_master_user()
          OR current_setting('role', true) = 'service_role') THEN
    RAISE EXCEPTION 'sem permissão sobre este funil' USING ERRCODE = '42501';
  END IF;

  -- A recusa: card de outro funil parado numa etapa deste — decisão é humana.
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

  v_impact := public.custom_pipeline_delete_impact(p_pipeline_id);

  UPDATE public.workflows w
     SET is_active = false,
         updated_at = now()
   WHERE w.organization_id = v_org
     AND w.is_active
     AND (strpos(w.definition::text, p_pipeline_id::text) > 0
       OR strpos(w.trigger_config::text, p_pipeline_id::text) > 0);
  GET DIAGNOSTICS v_wf = ROW_COUNT;

  UPDATE public.blast_plans
     SET post_send_target = NULL,
         updated_at = now()
   WHERE organization_id = v_org
     AND status IN ('active', 'paused')
     AND post_send_target->>'pipelineId' = p_pipeline_id::text;
  GET DIAGNOSTICS v_bp = ROW_COUNT;

  -- Filhos antes do pai, direto na fonte (o sync que limpava o espelho morreu).
  DELETE FROM public.pipeline_entries WHERE pipeline_id = p_pipeline_id;
  DELETE FROM public.pipeline_stages  WHERE pipeline_id = p_pipeline_id;

  -- O pai: CASCADE leva pipeline_stage_events, custom_pipeline_members e
  -- custom_pipe_transitions (FKs repontadas nesta migration).
  DELETE FROM public.pipelines WHERE id = p_pipeline_id AND type = 'custom';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DELETE não afetou nenhuma linha' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_impact || jsonb_build_object(
    'automacoes_desativadas', v_wf,
    'disparos_neutralizados', v_bp
  );
END;
$function$

;

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
  v_movidos     integer;
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

    -- Pipeline de sistema alvo, dentro da org do lead
    SELECT p.id INTO v_pipeline_id
    FROM public.pipelines p
    WHERE p.slug = p_target_pipe
      AND p.organization_id = v_lead_org
      AND p.type = 'system' -- metric-lint-allow: predicado PRESERVADO verbatim da função original, e não é filtro de métrica — é o roteamento entre as duas RPCs: bulk_move_stage resolve os 3 funis de sistema por slug, funil custom tem RPC própria (bulk_add_to_custom_pipe, por pipeline_id). Parametrizar aqui mudaria o contrato da função, fora do escopo desta fatia.
    LIMIT 1;

    IF v_pipeline_id IS NULL THEN
      CONTINUE;
    END IF;

    -- MOVE TODOS os negócios do lead nesse funil (decisão CTO 2026-07-31).
    -- Casar N linhas aqui é o comportamento pretendido, não um efeito colateral.
    -- O filtro por organization_id é redundante com a resolução de v_pipeline_id
    -- (o pipeline já foi buscado dentro de v_lead_org) e é defesa em
    -- profundidade contra linha com org divergente; medido em prod 2026-07-31:
    -- 0 linhas de pipeline_entries com organization_id ≠ org do lead (`IS
    -- DISTINCT FROM`, não `<>`, para não mascarar NULL — e a coluna é NOT NULL
    -- nas duas tabelas), então o filtro não esconde nenhuma linha existente.
    -- `closed_at IS NULL`: move todos os negócios ABERTOS do lead, nunca os
    -- fechados (decisão CTO 2026-07-31, revendo o "todos" da véspera).
    --
    -- Por que o fechado fica de fora, medido em prod 2026-07-31: tirar um
    -- negócio da etapa de ganho estorna a venda, e o estorno é IRREVERSÍVEL.
    -- A cadeia é UPDATE de stage_key → `trg_pipeline_entries_stage_event_update`
    -- → `fn_capture_pipeline_stage_event` → `trg_pipeline_stage_events_sale_capture`
    -- → `fn_capture_sale_event`, que em `from_role = 'won' AND to_role <> 'won'`
    -- insere `sale_reversed` — e casa a venda original por
    -- `lead_id + pipeline_id`, NUNCA por entry. `trg_sale_events_immutable`
    -- (BEFORE DELETE OR UPDATE) impede desfazer. Exposição medida: 217 cards em
    -- etapa ganha, 217 leads, 23 orgs, 273 vendas no ledger. Sem este filtro,
    -- um arraste em massa mexeria no painel de receita de terceiros.
    UPDATE public.pipeline_entries pe
       SET stage_key        = p_target_stage,
           stage_changed_at = now(),
           updated_at       = now()
     WHERE pe.pipeline_id     = v_pipeline_id
       AND pe.lead_id         = v_lead_id
       AND pe.organization_id = v_lead_org
       AND pe.closed_at IS NULL;

    GET DIAGNOSTICS v_movidos = ROW_COUNT;

    -- Cria quando o lead não tem nenhum negócio ABERTO neste funil — o que
    -- inclui o caso "só tem negócio fechado". Isso é recompra, e é a feature
    -- funcionando: o negócio ganho de março fica intacto no histórico e a
    -- movimentação de hoje abre um segundo negócio. Antes do drop dos cadeados
    -- isso era impossível, e o upsert resolvia em UPDATE do card fechado —
    -- que é exatamente o caminho que estornava a venda.
    --
    -- Frequência de trigger, dito com precisão (medido em `pg_trigger`, prod
    -- 2026-07-31) — a afirmação larga "o volume de triggers de INSERT não muda"
    -- estava numa versão anterior deste comentário e é falsa pela metade:
    --   • AFTER INSERT (`trg_pipeline_entries_stage_event_insert`): frequência
    --     IDÊNTICA. Com conflito o Postgres já disparava AFTER UPDATE, nunca
    --     AFTER INSERT — o caminho não muda.
    --   • BEFORE INSERT (`trg_pe_snapshot_responsibles`;
    --     `trg_enforce_closed_at` é BEFORE INSERT OR UPDATE OF stage_key):
    --     disparavam para toda linha PROPOSTA, inclusive quando o upsert anterior
    --     resolvia em UPDATE. Agora só disparam no INSERT de verdade — o volume
    --     CAI. Sem efeito observável hoje: li as duas funções em prod e ambas só
    --     mutam `NEW`, que era descartado no caminho de conflito. Quem adicionar
    --     um BEFORE INSERT com efeito colateral externo (escrita em outra tabela,
    --     http_post) precisa saber disso e não pode ler "a reescrita foi neutra".
    --   • UPDATE: aí sim a frequência MUDA por desenho — passa a ser 1 por
    --     negócio do lead neste funil, não 1 por lead. Ver "Consequência 3" no
    --     cabeçalho (fan-out de `stage_changed` e de dispatch).
    IF v_movidos = 0 THEN
      INSERT INTO public.pipeline_entries (
        organization_id, pipeline_id, lead_id, stage_key, stage_changed_at, entered_at
      ) VALUES (
        v_lead_org, v_pipeline_id, v_lead_id, p_target_stage, now(), now()
      );
    END IF;
  END LOOP;
END;
$function$

;

CREATE OR REPLACE FUNCTION public.bulk_add_to_custom_pipe(p_lead_ids uuid[], p_pipeline_id uuid, p_stage_id uuid)
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

    -- Funil custom alvo deve pertencer a org do lead e estar ativo
    IF NOT EXISTS (
      SELECT 1 FROM public.custom_pipelines cp
      WHERE cp.id = p_pipeline_id
        AND cp.organization_id = v_lead_org
        AND cp.is_active = true
    ) THEN
      CONTINUE;
    END IF;

    -- Etapa alvo deve pertencer ao funil
    IF NOT EXISTS (
      SELECT 1 FROM public.custom_pipeline_stages cps
      WHERE cps.id = p_stage_id
        AND cps.pipeline_id = p_pipeline_id
    ) THEN
      CONTINUE;
    END IF;

    -- Move todos os negócios ABERTOS do lead nesse funil (decisão CTO
    -- 2026-07-31). Medido em prod 2026-07-31: 0 linhas de custom_pipe_entries
    -- com organization_id ≠ org do lead, então o filtro de org não esconde
    -- linha existente.
    --
    -- `custom_pipe_entries` NÃO tem `closed_at` (medido: 0 colunas), então
    -- "fechado" aqui só pode vir do papel da etapa. E hoje o filtro é
    -- DEFENSIVO, não ativo: `custom_pipeline_stages.stage_role` em prod tem
    -- apenas `open`, `meeting_booked` e `meeting_held` — nenhum `won`/`lost`,
    -- logo 0 entries custom em etapa fechada. Fica escrito para o dia em que
    -- alguém criar uma etapa de ganho num funil custom, porque aí o espelho em
    -- `pipeline_entries` passa a alcançar a mesma cadeia de estorno.
    UPDATE public.custom_pipe_entries ce
       SET stage_id         = p_stage_id,
           stage_changed_at = now(),
           updated_at       = now()
     WHERE ce.pipeline_id     = p_pipeline_id
       AND ce.lead_id         = v_lead_id
       AND ce.organization_id = v_lead_org
       AND NOT EXISTS (
         SELECT 1
         FROM public.custom_pipeline_stages cs
         WHERE cs.id = ce.stage_id
           AND cs.stage_role IN ('won', 'lost')
       );

    GET DIAGNOSTICS v_movidos = ROW_COUNT;

    -- Mesma condição do upsert anterior: só insere quando não havia nada.
    -- Importa porque INSERT em custom_pipe_entries dispara
    -- `trg_workflow_custom_pipe_entry` (medido: AFTER INSERT), que re-emite
    -- lead_created sem origin no contexto — armadilha conhecida de envio em massa.
    --
    -- Escopo exato da afirmação, porque aqui do lado tem uma armadilha de envio e
    -- imprecisão custa caro: a frequência de **AFTER INSERT** não muda (com
    -- conflito o Postgres já disparava AFTER UPDATE, não AFTER INSERT), logo ESTA
    -- armadilha não é ampliada. O que MUDA é o caminho de **UPDATE**: passa a ser
    -- 1 disparo por negócio do lead neste funil, não 1 por lead — ver
    -- "Consequência 3" no cabeçalho. Uma versão anterior deste comentário concluía
    -- "o risco não é ampliado aqui" sem essa distinção; era falso por omissão, e
    -- falso justamente na direção que a decisão "mover TODOS" cria.
    IF v_movidos = 0 THEN
      INSERT INTO public.custom_pipe_entries (
        organization_id, pipeline_id, lead_id, stage_id, entered_at, stage_changed_at
      ) VALUES (
        v_lead_org, p_pipeline_id, v_lead_id, p_stage_id, now(), now()
      );
    END IF;
  END LOOP;
END;
$function$

;

-- ── 3) Derrubar as funções novas ────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.bulk_add_to_pipeline(uuid[], uuid, uuid);
DROP FUNCTION IF EXISTS public.delete_pipeline(uuid);
DROP FUNCTION IF EXISTS public.pipeline_delete_impact(uuid);
DROP FUNCTION IF EXISTS public.get_pipeline_lead_ids(uuid, text, uuid, text, text, uuid, uuid[], text[], text[], text[], uuid);
DROP FUNCTION IF EXISTS public.get_pipeline_stage_counts_by_id(uuid, uuid, text, uuid, uuid[], text[], integer, integer, integer, integer, text, text, timestamptz, timestamptz, timestamptz, timestamptz, text[], timestamptz, text[], text[], boolean, text[], text[], integer, integer);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname IN
              ('delete_pipeline','pipeline_delete_impact','bulk_add_to_pipeline',
               'get_pipeline_lead_ids','get_pipeline_stage_counts_by_id')) THEN
    RAISE EXCEPTION 'ROLLBACK SCRUM-626: função nova sobreviveu ao DROP';
  END IF;
  RAISE NOTICE 'ROLLBACK SCRUM-626 OK: 12 definições de prod restauradas, 6 funções novas removidas';
END;
$$;
