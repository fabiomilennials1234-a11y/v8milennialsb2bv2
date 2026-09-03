-- rollback/20270919000000_projecao_canonica_do_negocio.sql — SCRUM-647
--
-- Desfaz a 20270919000000. Os 6 corpos abaixo são a saída LITERAL de
-- `pg_get_functiondef` contra PRODUÇÃO (jsjsmuncfkbsbzqzqhfq) em 2026-09-03,
-- antes de qualquer alteração — não são reconstrução de memória nem cópia do
-- repo (o repo estava desatualizado em 2 destes: ver o inventário).
--
-- CREATE OR REPLACE, nunca DROP+CREATE: um DROP devolveria EXECUTE para
-- PUBLIC/anon. Confira depois de rodar:
--   select p.proname, p.proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and p.proname in
--    ('api_get_lead','api_list_leads','get_next_pipe_closer','get_pipeline_lead_ids',
--     'get_meeting_reminder_candidates','get_seller_activity_scores');
--
-- E o ledger:
--   delete from supabase_migrations.schema_migrations where version = '20270919000000';

BEGIN;

-- 1. A projeção sai. Nada mais deve depender dela neste ponto.
DROP VIEW IF EXISTS public.negocio_projetado;

-- 2. Os 6 corpos exatos de prod de 2026-09-03.

-- ── api_get_lead — proacl em prod: postgres=X/postgres | service_role=X/postgres
CREATE OR REPLACE FUNCTION public.api_get_lead(p_org uuid, p_lead_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'id', l.id, 'name', l.name, 'company', l.company, 'email', l.email, 'phone', l.phone,
    'origin', l.origin::text, 'rating', l.rating, 'qualification_score', l.qualification_score,
    'tier', COALESCE(l.qualification_tier, l.pre_qualification_tier)::text,
    'responsible_id', l.responsible_id, 'sdr_id', l.sdr_id, 'closer_id', l.closer_id,
    'pre_sale_responsible_id', l.pre_sale_responsible_id, 'sale_responsible_id', l.sale_responsible_id,
    'created_at', l.created_at, 'updated_at', l.updated_at,
    'tags', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color))
      FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id WHERE lt.lead_id = l.id), '[]'::jsonb),
    'custom_fields', COALESCE((SELECT jsonb_agg(jsonb_build_object('field_name', cf.field_name,
      'field_type', cf.field_type, 'value', cfv.value) ORDER BY cf.display_order)
      FROM lead_custom_field_values cfv JOIN lead_custom_fields cf ON cf.id = cfv.field_id
      WHERE cfv.lead_id = l.id), '[]'::jsonb),
    'pipes', COALESCE((SELECT jsonb_agg(jsonb_build_object('pipeline', pip.slug, 'pipeline_name', pip.name,
      'type', pip.type, 'stage_key', pe.stage_key,
      'sold', (pe.stage_key = 'vendido' AND pip.slug = 'propostas' AND pip.type = 'system'),
      'sale_value', (pe.metadata->>'sale_value')::numeric, 'entered_at', pe.entered_at,
      'stage_changed_at', pe.stage_changed_at) ORDER BY pip.display_order)
      FROM pipeline_entries pe JOIN pipelines pip ON pip.id = pe.pipeline_id
      WHERE pe.lead_id = l.id AND pe.organization_id = p_org), '[]'::jsonb)
  )
  FROM leads l
  WHERE l.id = p_lead_id AND l.organization_id = p_org AND l.deleted_at IS NULL;
$function$;

-- ── api_list_leads — proacl em prod: postgres=X/postgres | service_role=X/postgres
CREATE OR REPLACE FUNCTION public.api_list_leads(p_org uuid, p_stage text[] DEFAULT NULL::text[], p_tier text[] DEFAULT NULL::text[], p_tag text[] DEFAULT NULL::text[], p_origin text[] DEFAULT NULL::text[], p_responsible_id uuid DEFAULT NULL::uuid, p_created_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_created_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_q text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_cursor_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, name text, company text, email text, phone text, origin text, rating integer, qualification_score integer, tier_efetivo text, tags jsonb, responsible_id uuid, sdr_id uuid, closer_id uuid, sold boolean, sale_value numeric, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    l.id,
    l.name,
    l.company,
    l.email,
    l.phone,
    l.origin::text,
    l.rating,
    l.qualification_score,
    COALESCE(l.qualification_tier, l.pre_qualification_tier)::text AS tier_efetivo,
    COALESCE(
      (
        SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color))
        FROM lead_tags lt
        JOIN tags t ON t.id = lt.tag_id
        WHERE lt.lead_id = l.id
      ),
      '[]'::jsonb
    ) AS tags,
    l.responsible_id,
    l.sdr_id,
    l.closer_id,
    COALESCE(v.sold, false) AS sold,
    v.sale_value,
    l.created_at
  FROM leads l
  LEFT JOIN LATERAL (
    SELECT true AS sold, (pe.metadata->>'sale_value')::numeric AS sale_value
    FROM pipeline_entries pe
    JOIN pipelines pip
      ON pip.id = pe.pipeline_id AND pip.slug = 'propostas' AND pip.type = 'system'
    WHERE pe.lead_id = l.id
      AND pe.organization_id = p_org
      AND pe.stage_key = 'vendido'
    LIMIT 1
  ) v ON true
  WHERE l.organization_id = p_org
    AND l.deleted_at IS NULL
    AND COALESCE(l.is_shadow, false) = false
    AND (p_tier IS NULL
         OR COALESCE(l.qualification_tier, l.pre_qualification_tier)::text = ANY(p_tier))
    AND (p_origin IS NULL OR l.origin::text = ANY(p_origin))
    AND (p_responsible_id IS NULL
         OR p_responsible_id IN (
              l.responsible_id, l.sdr_id, l.closer_id,
              l.pre_sale_responsible_id, l.sale_responsible_id
            ))
    AND (p_created_from IS NULL OR l.created_at >= p_created_from)
    AND (p_created_to IS NULL OR l.created_at <= p_created_to)
    AND (p_q IS NULL OR (
           l.name ILIKE '%' || p_q || '%'
        OR l.company ILIKE '%' || p_q || '%'
        OR l.email ILIKE '%' || p_q || '%'
        OR l.phone ILIKE '%' || p_q || '%'
    ))
    AND (p_stage IS NULL OR EXISTS (
           SELECT 1 FROM pipeline_entries pe2
           WHERE pe2.lead_id = l.id
             AND pe2.organization_id = p_org
             AND pe2.stage_key = ANY(p_stage)
    ))
    AND (p_tag IS NULL OR EXISTS (
           SELECT 1 FROM lead_tags lt2
           JOIN tags t2 ON t2.id = lt2.tag_id
           WHERE lt2.lead_id = l.id
             AND lower(t2.name) = ANY(SELECT lower(x) FROM unnest(p_tag) AS x)
    ))
    AND (
      p_cursor_created_at IS NULL
      OR l.created_at < p_cursor_created_at
      OR (l.created_at = p_cursor_created_at AND l.id < p_cursor_id)
    )
  ORDER BY l.created_at DESC, l.id DESC
  LIMIT GREATEST(p_limit, 1);
$function$;

-- ── get_next_pipe_closer — proacl em prod: =X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres
CREATE OR REPLACE FUNCTION public.get_next_pipe_closer(p_pipe_type text, p_organization_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rule_id UUID;
  v_mode TEXT;
  v_assigned_to UUID;
  v_member_ids UUID[];
  v_count BIGINT;
  v_next_index INT;
BEGIN
  SELECT id, closer_mode, closer_assigned_to
    INTO v_rule_id, v_mode, v_assigned_to
  FROM public.pipe_distribution_rules
  WHERE organization_id = p_organization_id
    AND pipe_type = p_pipe_type
  LIMIT 1;

  IF v_rule_id IS NULL OR v_mode IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_mode = 'single' AND v_assigned_to IS NOT NULL THEN
    RETURN v_assigned_to;
  END IF;

  SELECT ARRAY_AGG(pdm.team_member_id ORDER BY pdm.created_at, pdm.team_member_id)
    INTO v_member_ids
  FROM public.pipe_distribution_members pdm
  WHERE pdm.rule_id = v_rule_id
    AND pdm.role = 'closer';

  IF v_member_ids IS NULL OR array_length(v_member_ids, 1) IS NULL OR array_length(v_member_ids, 1) = 0 THEN
    RETURN NULL;
  END IF;

  IF v_mode = 'random' THEN
    RETURN v_member_ids[1 + floor(random() * array_length(v_member_ids, 1))::int];
  END IF;

  IF v_mode = 'round_robin' THEN
    -- Count records with closer_id set in pipeline_entries for this pipe slug
    SELECT count(*) INTO v_count
    FROM public.pipeline_entries pe
    JOIN public.pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = p_pipe_type AND pip.type = 'system'
    WHERE pe.organization_id = p_organization_id
      AND (pe.metadata->>'closer_id')::uuid IS NOT NULL;

    v_next_index := (COALESCE(v_count, 0) % array_length(v_member_ids, 1)) + 1;
    RETURN v_member_ids[v_next_index];
  END IF;

  RETURN NULL;
END;
$function$;

-- ── get_pipeline_lead_ids — proacl em prod: postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres
CREATE OR REPLACE FUNCTION public.get_pipeline_lead_ids(p_pipeline_id uuid DEFAULT NULL::uuid, p_pipeline_slug text DEFAULT NULL::text, p_stage_id uuid DEFAULT NULL::uuid, p_stage_key text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_responsible_id uuid DEFAULT NULL::uuid, p_tag_ids uuid[] DEFAULT NULL::uuid[], p_qualification_tier text[] DEFAULT NULL::text[], p_pre_qualification_tier text[] DEFAULT NULL::text[], p_origin text[] DEFAULT NULL::text[], p_organization_id uuid DEFAULT NULL::uuid)
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

-- ── get_meeting_reminder_candidates — proacl em prod: postgres=X/postgres | service_role=X/postgres
CREATE OR REPLACE FUNCTION public.get_meeting_reminder_candidates(p_organization_id uuid, p_stage_keys text[])
 RETURNS TABLE(lead_id uuid, whatsapp_stage text, meeting_date timestamp with time zone, last_inbound_at timestamp with time zone, last_outbound_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH wf AS (
    SELECT pe.lead_id, pe.stage_key, (pe.metadata->>'scheduled_date')::timestamptz AS meeting_date
    FROM pipeline_entries pe
    JOIN pipelines p ON p.id = pe.pipeline_id AND p.slug = 'whatsapp' AND p.type = 'system'
    WHERE pe.organization_id = p_organization_id
      AND pe.stage_key = ANY(p_stage_keys)
      AND pe.metadata->>'scheduled_date' IS NOT NULL
      AND (pe.metadata->>'scheduled_date')::timestamptz > now()
  )
  SELECT w.lead_id, w.stage_key, w.meeting_date,
    (SELECT max(wm.timestamp) FROM whatsapp_messages wm
       WHERE wm.lead_id=w.lead_id AND wm.organization_id=p_organization_id AND wm.direction='incoming'),
    (SELECT max(wm.timestamp) FROM whatsapp_messages wm
       WHERE wm.lead_id=w.lead_id AND wm.organization_id=p_organization_id AND wm.direction='outgoing')
  FROM wf w;
$function$;

-- ── get_seller_activity_scores — proacl em prod: postgres=X/postgres | authenticated=X/postgres | service_role=X/postgres
CREATE OR REPLACE FUNCTION public.get_seller_activity_scores(p_org_id uuid, p_start_date timestamp with time zone, p_end_date timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE result JSONB;
BEGIN
  PERFORM public.assert_org_access(p_org_id);
  WITH seller_metrics AS (
    SELECT tm.id, tm.name, tm.role, (tm.metric_type)::TEXT AS metric_type,
      (SELECT COUNT(*)
       FROM leads l
       WHERE l.organization_id = p_org_id
         AND (l.sdr_id = tm.id OR l.closer_id = tm.id)
         AND COALESCE(l.metrics_period_at, l.created_at) >= p_start_date
         AND COALESCE(l.metrics_period_at, l.created_at) <= p_end_date
      ) AS leads_movimentados,
      (SELECT COUNT(*)
       FROM follow_ups fu
       WHERE fu.organization_id = p_org_id
         AND fu.assigned_to = tm.id
         AND fu.completed_at IS NOT NULL
         AND fu.completed_at >= p_start_date
         AND fu.completed_at <= p_end_date
      ) AS followups_completos,
      (SELECT COUNT(*)
       FROM pipeline_entries pe
       JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'confirmacao' AND pip.type = 'system'
       WHERE pe.organization_id = p_org_id
         AND ((pe.metadata->>'sdr_id')::uuid = tm.id OR (pe.metadata->>'closer_id')::uuid = tm.id)
         AND pe.stage_key = 'compareceu'
         AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) >= p_start_date
         AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) <= p_end_date
      ) AS reunioes_realizadas,
      (SELECT COUNT(*)
       FROM pipeline_entries pe
       JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'propostas' AND pip.type = 'system'
       WHERE pe.organization_id = p_org_id
         AND (pe.metadata->>'closer_id')::uuid = tm.id
         AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) >= p_start_date
         AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) <= p_end_date
      ) AS propostas_enviadas,
      (SELECT COUNT(*)
       FROM pipeline_entries pe
       JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'propostas' AND pip.type = 'system'
       WHERE pe.organization_id = p_org_id
         AND (pe.metadata->>'closer_id')::uuid = tm.id
         AND pe.stage_key = 'vendido'
         AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.closed_at) >= p_start_date
         AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.closed_at) <= p_end_date
      ) AS vendas_fechadas
    FROM team_members tm WHERE tm.organization_id = p_org_id AND tm.is_active = true
  ), scored AS (
    SELECT sm.*,
      (sm.leads_movimentados * 10 + sm.followups_completos * 15 + sm.reunioes_realizadas * 20 + sm.propostas_enviadas * 25 + sm.vendas_fechadas * 30) AS score_bruto
    FROM seller_metrics sm
  )
  SELECT jsonb_agg(jsonb_build_object(
    'id', s.id, 'name', s.name, 'role', s.role, 'metricType', s.metric_type,
    'leads', s.leads_movimentados, 'followups', s.followups_completos,
    'reunioes', s.reunioes_realizadas, 'propostas', s.propostas_enviadas,
    'vendas', s.vendas_fechadas, 'scoreBruto', s.score_bruto,
    'scoreNormalizado', CASE WHEN (SELECT MAX(score_bruto) FROM scored) > 0
      THEN ROUND((s.score_bruto::NUMERIC / (SELECT MAX(score_bruto) FROM scored)) * 100) ELSE 0 END
  ) ORDER BY s.score_bruto DESC) INTO result FROM scored s;
  RETURN COALESCE(result, '[]'::jsonb);
END; $function$;

COMMIT;
